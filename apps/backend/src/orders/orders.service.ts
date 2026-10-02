import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql, Transaction, Updateable } from 'kysely';
import { KYSELY } from '../database/database.module';
import {
  Database,
  OrderChannel,
  OrderDeliveryType,
  OrderPaymentMethod,
  OrderPaymentStatus,
  OrderPromotionComponentSnapshot,
  OrdersTable,
  OrderStatus,
} from '../database/types';
import {
  DomainException,
  InvalidStateTransitionError,
  NotFoundDomainError,
  ProductUnavailableError,
  PromotionUnavailableError,
  StoreClosedError,
  ValidationError,
} from '../common/exceptions/domain-exception';
import { IdempotencyService } from '../common/idempotency/idempotency.service';
import { checkoutGateAt, lateRequestExpiryFor } from '../common/time/service-window';
import { OperationalSettingsService } from '../operational-settings/operational-settings.service';
import { DeliveryService } from '../delivery/delivery.service';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { QrCheckoutService } from '../bank-qr/qr-checkout.service';
import { QrPaymentsService } from '../bank-qr/qr-payments.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ReplaceOrderDto } from './dto/replace-order.dto';

export interface OrderItemResponse {
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  subtotal: number;
}

export interface OrderPromotionResponse {
  promotionId: string | null;
  promotionNameSnapshot: string;
  promoPriceSnapshot: number;
  comboQuantity: number;
  subtotal: number;
  componentsSnapshot: OrderPromotionComponentSnapshot[];
}

export interface OrderResponse {
  id: string;
  orderNumber: string;
  customerId: string | null;
  channel: string;
  customerName: string;
  deliveryType: string;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  notes: string | null;
  subtotalAmount: number;
  deliveryBaseAmount: number;
  deliverySurchargeAmount: number;
  totalAmount: number;
  deliveryQuoteStatus: string | null;
  deliveryDistanceMeters: number | null;
  cashConfirmedAt: string | null;
  statusUpdatedBy: string | null;
  createdAt: string;
  items: OrderItemResponse[];
  /** Combos vendidos. `items` solo trae los productos sueltos, así que sin esto el ticket y el tablero de cocina quedan incompletos. */
  promotions: OrderPromotionResponse[];
}

export interface LateOrderRequestAcceptedResponse {
  requestId: string;
  requestNumber: string;
  status: 'pending';
  subtotalAmount: number;
  expiresAt: string;
}

export interface ActiveOrderContextResponse {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: OrderPaymentMethod;
  totalAmount: number;
  subtotalAmount: number;
  deliveryType: OrderDeliveryType;
  deliveryQuoteStatus: string | null;
  cashConfirmed: boolean;
  locationReceived: boolean;
  proofReceived: boolean;
  latestPaymentAttempt: {
    reviewStatus: 'pending_review' | 'accepted' | 'rejected';
    reviewedAt: string | null;
  } | null;
  createdAt: string;
}

export type CreateOrderOutcome =
  | { httpStatus: 200 | 201; body: OrderResponse }
  | { httpStatus: 202; body: LateOrderRequestAcceptedResponse };

export interface ReplaceOrderResponse {
  replacedOrderId: string;
  order: OrderResponse;
}

export interface CheckoutCartInput {
  customerId: string | null;
  channel: OrderChannel;
  customerName: string;
  deliveryType: OrderDeliveryType;
  paymentMethod: OrderPaymentMethod;
  notes: string | null;
  items: { productId: string; quantity: number }[];
  promotions: { promotionId: string; quantity: number; revision: number }[];
  /** Solo lo pasa LateOrderRequestsService.accept() — un pedido normal nace sin caja, se vincula recién al cobrarse. */
  registerSessionId?: string | null;
}

const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'awaiting_location',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
];

const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['awaiting_location', 'confirmed', 'cancelled'],
  awaiting_location: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/**
 * Corazón del sistema. Porta `create_order_web_v5` (saas_smarky,
 * `0029_promotions.sql`) al esquema nuevo: sin `menu_sessions` (el
 * `Idempotency-Key` genérico reemplaza sesión+fingerprint) y con
 * products/categories en vez de menu_items con enum.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly idempotency: IdempotencyService,
    private readonly operationalSettings: OperationalSettingsService,
    private readonly deliveryService: DeliveryService,
    private readonly notifications: NotificationsOutService,
    private readonly cashRegister: CashRegisterService,
    private readonly qrCheckout: QrCheckoutService,
    private readonly qrPayments: QrPaymentsService,
  ) {}

  async findById(id: string): Promise<OrderResponse> {
    const order = await this.db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!order) throw new NotFoundDomainError('order', id);
    const { items, promotions } = await loadOrderLines(this.db, id);
    return toOrderResponse(order, items, promotions);
  }

  async findMany(filter: {
    customerId?: string;
    status?: OrderStatus;
    deliveryType?: OrderDeliveryType;
    paymentStatus?: OrderPaymentStatus;
    limit?: number;
    offset?: number;
  }): Promise<OrderResponse[]> {
    let query = this.db.selectFrom('orders').selectAll();
    if (filter.customerId) query = query.where('customer_id', '=', filter.customerId);
    if (filter.status) query = query.where('status', '=', filter.status);
    if (filter.deliveryType) query = query.where('delivery_type', '=', filter.deliveryType);
    if (filter.paymentStatus) query = query.where('payment_status', '=', filter.paymentStatus);
    const orders = await query
      .orderBy('created_at', 'desc')
      .limit(Math.min(filter.limit ?? 50, 200))
      .offset(filter.offset ?? 0)
      .execute();
    if (orders.length === 0) return [];

    const orderIds = orders.map((o) => o.id);
    const items = await this.db
      .selectFrom('order_items')
      .selectAll()
      .where('order_id', 'in', orderIds)
      .execute();
    const promotions = await this.db
      .selectFrom('order_promotions')
      .selectAll()
      .where('order_id', 'in', orderIds)
      .execute();

    const itemsByOrder = groupByOrderId(items);
    const promotionsByOrder = groupByOrderId(promotions);
    return orders.map((order) =>
      toOrderResponse(
        order,
        itemsByOrder.get(order.id) ?? [],
        promotionsByOrder.get(order.id) ?? [],
      ),
    );
  }

  async findActiveOrderContext(
    customerId: string,
  ): Promise<ActiveOrderContextResponse | null> {
    const customer = await this.db
      .selectFrom('customers')
      .select('id')
      .where('id', '=', customerId)
      .executeTakeFirst();
    if (!customer) throw new NotFoundDomainError('customer', customerId);

    const order = await this.db
      .selectFrom('orders')
      .select([
        'id',
        'order_number',
        'status',
        'payment_status',
        'payment_method',
        'total_amount',
        'subtotal_amount',
        'delivery_type',
        'delivery_quote_status',
        'cash_confirmed_at',
        'delivery_latitude',
        'created_at',
      ])
      .where('customer_id', '=', customerId)
      .where('status', 'in', [...ACTIVE_ORDER_STATUSES])
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!order) return null;

    const [attempt, proof] = await Promise.all([
      this.db
        .selectFrom('payment_attempts')
        .select(['review_status', 'reviewed_at'])
        .where('order_id', '=', order.id)
        .orderBy('opened_at', 'desc')
        .limit(1)
        .executeTakeFirst(),
      this.db
        .selectFrom('payment_proofs')
        .select('id')
        .where('order_id', '=', order.id)
        .limit(1)
        .executeTakeFirst(),
    ]);

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      paymentStatus: order.payment_status,
      paymentMethod: order.payment_method,
      totalAmount: Number(order.total_amount),
      subtotalAmount: Number(order.subtotal_amount),
      deliveryType: order.delivery_type,
      deliveryQuoteStatus: order.delivery_quote_status,
      cashConfirmed: order.cash_confirmed_at !== null,
      locationReceived: order.delivery_latitude !== null,
      proofReceived: proof !== undefined,
      latestPaymentAttempt: attempt
        ? {
            reviewStatus: attempt.review_status,
            reviewedAt: attempt.reviewed_at
              ? new Date(attempt.reviewed_at).toISOString()
              : null,
          }
        : null,
      createdAt: new Date(order.created_at).toISOString(),
    };
  }

  /**
   * POST /orders. Gate de horario evaluado ANTES que todo lo demás
   * (invariante 7): afuera del margen horario -> 409 cerrado; adentro, la
   * caja decide (ver checkoutGateAt) -> sin caja abierta, 202 +
   * late_order_requests (no consume la Idempotency-Key genérica, usa la
   * suya propia como columna única, igual que delivery_quote_requests).
   * `bypassHoursGate` solo se honra para channel='pos' (decisión de
   * producto — POS puede vender fuera del horario de delivery de WhatsApp,
   * y de la caja: el mostrador vende sin necesitar sesión de caja abierta
   * para simplemente CREAR el pedido, aunque cobrarlo sí la va a exigir).
   */
  async create(
    dto: CreateOrderDto,
    idempotencyKey: string,
    apiClient: string,
  ): Promise<CreateOrderOutcome> {
    const settings = await this.operationalSettings.getRow();
    if (settings.orders_paused && dto.channel !== 'pos') {
      throw new DomainException(
        'orders_paused',
        HttpStatus.CONFLICT,
        'Los pedidos nuevos están pausados temporalmente.',
      );
    }
    if (dto.deliveryType === 'pickup' && !settings.pickup_enabled) {
      throw new DomainException(
        'pickup_disabled',
        HttpStatus.CONFLICT,
        'El recojo en local está deshabilitado temporalmente.',
      );
    }
    const now = new Date();
    const bypassAllowed = dto.bypassHoursGate === true && dto.channel === 'pos';
    const gate = bypassAllowed
      ? ({ gate: 'proceed' } as const)
      : checkoutGateAt(
          now,
          { opensHour: settings.business_opens_hour, closesHour: settings.business_closes_hour },
          await this.cashRegister.isOpen(),
        );

    if (gate.gate === 'closed') {
      throw new StoreClosedError();
    }

    if (gate.gate === 'late_review') {
      const body = await this.createLateOrderRequest(dto, idempotencyKey, now);
      return { httpStatus: 202, body };
    }

    const outcome = await this.idempotency.run({
      apiClient,
      endpoint: 'POST /orders',
      idempotencyKey,
      requestBody: dto,
      execute: (trx) => this.executeCreateOrder(trx, dto),
    });

    // Fuera de la transacción a propósito: notifyOrderCreated hace una
    // lectura propia del pedido (otra conexión) y, para QR, una llamada HTTP
    // al banco — si corriera adentro del trx de arriba, la lectura no vería
    // el INSERT todavía sin commitear ("order no existe"), y la llamada
    // externa quedaría sosteniendo la transacción abierta. Solo en una
    // creación real (no en una respuesta cacheada de un reintento).
    if (outcome.created) {
      this.notifyOrderCreated(outcome.body).catch((error: Error) =>
        this.logger.warn(`notifyOrderCreated falló para ${outcome.body.id}: ${error.message}`),
      );
    }

    return { httpStatus: outcome.created ? 201 : 200, body: outcome.body };
  }

  async expireStaleOrders(now = new Date()): Promise<{
    cancelled: number;
    cashUnconfirmed: number;
    awaitingLocation: number;
  }> {
    const cashCutoff = new Date(now.getTime() - 20 * 60_000);
    const locationCutoff = new Date(now.getTime() - 45 * 60_000);

    const result = await this.db.transaction().execute(async (trx) => {
      const cashRows = await trx
        .updateTable('orders')
        .set({
          status: 'cancelled',
          status_updated_by: 'expiry_cash_unconfirmed',
          updated_at: now,
        })
        .where('payment_method', '=', 'cash')
        .where('status', '=', 'confirmed')
        .where('cash_confirmed_at', 'is', null)
        .where('confirmed_at', 'is not', null)
        .where('confirmed_at', '<', cashCutoff)
        .returning(['id', 'order_number', 'customer_id'])
        .execute();

      const locationRows = await trx
        .updateTable('orders')
        .set({
          status: 'cancelled',
          status_updated_by: 'expiry_awaiting_location',
          updated_at: now,
        })
        .where('status', '=', 'awaiting_location')
        .where('delivery_type', '=', 'delivery')
        .where('delivery_latitude', 'is', null)
        .where('created_at', '<', locationCutoff)
        .returning(['id', 'order_number', 'customer_id'])
        .execute();

      return { cashRows, locationRows };
    });

    for (const order of result.cashRows) {
      if (!order.customer_id) continue;
      try {
        await this.notifications.notifyNow({
          channel: 'whatsapp',
          kind: 'cash_expired_customer_notice',
          targetRef: order.id,
          payload: {
            customerId: order.customer_id,
            text: `Tu pedido ${order.order_number} se canceló porque no recibimos la confirmación del pago en efectivo a tiempo.`,
          },
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo avisar expiración cash de ${order.id}: ${(error as Error).message}`,
        );
      }
    }

    return {
      cancelled: result.cashRows.length + result.locationRows.length,
      cashUnconfirmed: result.cashRows.length,
      awaitingLocation: result.locationRows.length,
    };
  }

  async replace(
    orderId: string,
    dto: ReplaceOrderDto,
    idempotencyKey: string,
    apiClient: string,
  ): Promise<{ httpStatus: 200 | 201; body: ReplaceOrderResponse }> {
    const settings = await this.operationalSettings.getRow();
    if (settings.orders_paused && dto.channel !== 'pos') {
      throw new DomainException(
        'orders_paused',
        HttpStatus.CONFLICT,
        'Los pedidos nuevos están pausados temporalmente.',
      );
    }
    if (dto.deliveryType === 'pickup' && !settings.pickup_enabled) {
      throw new DomainException(
        'pickup_disabled',
        HttpStatus.CONFLICT,
        'El recojo en local está deshabilitado temporalmente.',
      );
    }

    const outcome = await this.idempotency.run({
      apiClient,
      endpoint: `POST /orders/${orderId}/replace`,
      idempotencyKey,
      requestBody: dto,
      execute: async (trx) => {
        const oldOrder = await trx
          .selectFrom('orders')
          .selectAll()
          .where('id', '=', orderId)
          .forUpdate()
          .executeTakeFirst();

        if (!oldOrder) throw new NotFoundDomainError('order', orderId);
        if (!oldOrder.customer_id) {
          throw new ValidationError('El pedido no tiene un cliente asociado para poder reemplazarlo.');
        }
        if (!['awaiting_location', 'confirmed'].includes(oldOrder.status)) {
          throw new DomainException(
            'order_not_replaceable',
            HttpStatus.CONFLICT,
            `El pedido no se puede reemplazar en estado ${oldOrder.status}.`,
            { status: oldOrder.status },
          );
        }
        if (
          oldOrder.payment_status === 'paid' ||
          oldOrder.payment_status === 'pending_review' ||
          oldOrder.cash_confirmed_at !== null ||
          oldOrder.delivery_fee_paid
        ) {
          throw new DomainException(
            'order_payment_in_progress',
            HttpStatus.CONFLICT,
            'El pedido ya tiene pago o cobro en curso y no se puede reemplazar automáticamente.',
          );
        }

        const [proof, activeAttempt, activeQr] = await Promise.all([
          trx
            .selectFrom('payment_proofs')
            .select('id')
            .where('order_id', '=', orderId)
            .limit(1)
            .executeTakeFirst(),
          trx
            .selectFrom('payment_attempts')
            .select('id')
            .where('order_id', '=', orderId)
            .where('review_status', 'in', ['pending_review', 'accepted'])
            .limit(1)
            .executeTakeFirst(),
          trx
            .selectFrom('bank_qr_charges')
            .select('id')
            .where('order_id', '=', orderId)
            .where('status', 'in', ['pending', 'confirmed', 'paid_unapplied'])
            .limit(1)
            .executeTakeFirst(),
        ]);

        if (proof || activeAttempt || activeQr) {
          throw new DomainException(
            'order_payment_in_progress',
            HttpStatus.CONFLICT,
            'El pedido ya tiene comprobante, intento de pago o QR activo.',
          );
        }

        let replacement = await this.createOrderInTransaction(trx, {
          customerId: oldOrder.customer_id,
          channel: dto.channel,
          customerName: oldOrder.customer_name,
          deliveryType: dto.deliveryType,
          paymentMethod: dto.paymentMethod,
          notes: dto.notes?.trim() || null,
          items: dto.items,
          promotions: (dto.promotions ?? []).map((promotion) => ({
            promotionId: promotion.promotionId,
            quantity: promotion.quantity,
            revision: promotion.revision,
          })),
          registerSessionId: oldOrder.register_session_id,
        });

        const relationUpdate: Updateable<OrdersTable> = {
          replaces_order_id: oldOrder.id,
          updated_at: new Date(),
        };

        if (
          dto.deliveryType === 'delivery' &&
          oldOrder.delivery_type === 'delivery' &&
          oldOrder.delivery_quote_status === 'quoted' &&
          oldOrder.delivery_latitude !== null &&
          oldOrder.delivery_longitude !== null
        ) {
          relationUpdate.delivery_pricing = oldOrder.delivery_pricing;
          relationUpdate.delivery_quote_status = 'quoted';
          relationUpdate.delivery_distance_meters = oldOrder.delivery_distance_meters;
          relationUpdate.delivery_latitude = oldOrder.delivery_latitude;
          relationUpdate.delivery_longitude = oldOrder.delivery_longitude;
          relationUpdate.delivery_base_amount = oldOrder.delivery_base_amount;
          relationUpdate.delivery_surcharge_amount = oldOrder.delivery_surcharge_amount;
          relationUpdate.total_amount = (
            replacement.subtotalAmount +
            Number(oldOrder.delivery_base_amount) +
            Number(oldOrder.delivery_surcharge_amount)
          ).toFixed(2);
          relationUpdate.status = 'confirmed';
          relationUpdate.confirmed_at = new Date();
        }

        const updatedReplacement = await trx
          .updateTable('orders')
          .set(relationUpdate)
          .where('id', '=', replacement.id)
          .returningAll()
          .executeTakeFirstOrThrow();

        await trx
          .updateTable('orders')
          .set({
            status: 'cancelled',
            status_updated_by: 'replacement',
            updated_at: new Date(),
          })
          .where('id', '=', oldOrder.id)
          .where('status', '=', oldOrder.status)
          .executeTakeFirstOrThrow();

        const lines = await loadOrderLines(trx, replacement.id);
        replacement = toOrderResponse(
          updatedReplacement,
          lines.items,
          lines.promotions,
        );

        return {
          status: HttpStatus.CREATED,
          body: {
            replacedOrderId: oldOrder.id,
            order: replacement,
          },
        };
      },
    });

    if (outcome.created) {
      this.notifyOrderCreated(outcome.body.order).catch((error: Error) =>
        this.logger.warn(
          `notifyOrderCreated falló para reemplazo ${outcome.body.order.id}: ${error.message}`,
        ),
      );
    }

    return {
      httpStatus: outcome.created ? 201 : 200,
      body: outcome.body,
    };
  }

  private async notifyOrderCreated(order: OrderResponse): Promise<void> {
    if (!order.customerId) return;

    try {
      await this.notifications.notifyNow({
        channel: 'whatsapp',
        kind: 'order_received',
        targetRef: order.id,
        payload: {
          customerId: order.customerId,
          text: `Recibimos tu pedido ${order.orderNumber}.`,
        },
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo notificar order_received para ${order.id}: ${(error as Error).message}`,
      );
    }

    if (order.deliveryType === 'delivery') {
      try {
        await this.requestLocation(order.id);
      } catch (error) {
        this.logger.warn(
          `No se pudo solicitar ubicación para ${order.id}: ${(error as Error).message}`,
        );
      }
    }

    if (order.paymentMethod === 'qr') {
      try {
        await this.qrCheckout.notifyIfReady(order.id);
      } catch (error) {
        this.logger.warn(
          `No se pudo preparar qr_confirmation para ${order.id}: ${(error as Error).message}`,
        );
      }
    }
  }

  private async executeCreateOrder(
    trx: Transaction<Database>,
    dto: CreateOrderDto,
  ): Promise<{ status: number; body: OrderResponse }> {
    const order = await this.createOrderInTransaction(trx, {
      customerId: dto.customerId ?? null,
      channel: dto.channel,
      customerName: dto.customerName,
      deliveryType: dto.deliveryType,
      paymentMethod: dto.paymentMethod,
      notes: dto.notes ?? null,
      items: dto.items,
      promotions: (dto.promotions ?? []).map((p) => ({
        promotionId: p.promotionId,
        quantity: p.quantity,
        revision: p.revision,
      })),
    });

    return { status: 201, body: order };
  }

  /**
   * Núcleo transaccional del checkout, reusado tanto por `create()` como por
   * `LateOrderRequestsService.accept()` (que lo llama dentro de su propia
   * transacción bloqueando la solicitud primero). Nunca se llama fuera de
   * una transacción real: todos los locks (`for share`) solo tienen sentido
   * ahí dentro.
   */
  async createOrderInTransaction(
    trx: Transaction<Database>,
    input: CheckoutCartInput,
  ): Promise<OrderResponse> {
    const items = input.items;
    const promotions = input.promotions;

    if (items.length > 20) {
      throw new ValidationError('El carrito admite como máximo 20 productos sueltos.');
    }
    if (promotions.length > 10) {
      throw new ValidationError('El carrito admite como máximo 10 promociones.');
    }
    if (items.length + promotions.length < 1) {
      throw new ValidationError('El carrito está vacío.');
    }

    const customerName = input.customerName.trim();
    if (!customerName || customerName.length > 100) {
      throw new ValidationError('customerName debe tener entre 1 y 100 caracteres.');
    }

    const notes = input.notes?.trim() || null;
    if (notes && notes.length > 500) {
      throw new ValidationError('notes admite como máximo 500 caracteres.');
    }

    const productIds = items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new ValidationError('El carrito tiene productos duplicados.');
    }
    const promotionIds = promotions.map((p) => p.promotionId);
    if (new Set(promotionIds).size !== promotionIds.length) {
      throw new ValidationError('El carrito tiene promociones duplicadas.');
    }

    if (input.customerId) {
      const customer = await trx
        .selectFrom('customers')
        .select('id')
        .where('id', '=', input.customerId)
        .executeTakeFirst();
      if (!customer) throw new NotFoundDomainError('customer', input.customerId);
    }

    // El reloj de la base, no el del proceso: la vigencia de promociones se
    // compara contra now() de Postgres, en la misma transacción que escribe.
    const nowRow = await sql<{ now: Date }>`select now() as "now"`.execute(trx);
    const now = nowRow.rows[0].now;

    // Lock de promotions (for share, id ascendente).
    const sortedPromotionIds = [...promotionIds].sort();
    const promotionRows =
      sortedPromotionIds.length > 0
        ? await trx
            .selectFrom('promotions')
            .selectAll()
            .where('id', 'in', sortedPromotionIds)
            .orderBy('id', 'asc')
            .forShare()
            .execute()
        : [];
    const promotionById = new Map(promotionRows.map((p) => [p.id, p]));

    const badPromotionIds = new Set<string>();
    for (const p of promotions) {
      const row = promotionById.get(p.promotionId);
      if (
        !row ||
        row.archived_at !== null ||
        row.is_active !== true ||
        (row.starts_at !== null && new Date(row.starts_at) > now) ||
        (row.ends_at !== null && new Date(row.ends_at) <= now) ||
        row.revision !== p.revision
      ) {
        badPromotionIds.add(p.promotionId);
      }
    }

    // Unión de productos sueltos + componentes de combo, lock for share, id asc.
    const promotionComponents =
      promotionIds.length > 0
        ? await trx
            .selectFrom('promotion_items')
            .selectAll()
            .where('promotion_id', 'in', promotionIds)
            .execute()
        : [];

    const allProductIds = Array.from(
      new Set([...productIds, ...promotionComponents.map((c) => c.product_id)]),
    ).sort();

    const productRows =
      allProductIds.length > 0
        ? await trx
            .selectFrom('products')
            .selectAll()
            .where('id', 'in', allProductIds)
            .orderBy('id', 'asc')
            .forShare()
            .execute()
        : [];
    const productById = new Map(productRows.map((p) => [p.id, p]));

    const inactiveProductIds = new Set<string>();
    const soldOutProductIds = new Set<string>();
    for (const id of allProductIds) {
      const row = productById.get(id);
      if (!row || row.is_active !== true) inactiveProductIds.add(id);
      else if (row.is_available !== true) soldOutProductIds.add(id);
    }

    // Rechazos de productos SUELTOS únicamente — un componente caído de un
    // combo tiña la promoción (P1005), no produce un rechazo de producto.
    const inactiveLooseItem = items.find((i) => inactiveProductIds.has(i.productId));
    if (inactiveLooseItem) {
      throw new ProductUnavailableError(inactiveLooseItem.productId, 'inactive');
    }
    const soldOutLooseItemIds = items
      .filter((i) => soldOutProductIds.has(i.productId))
      .map((i) => i.productId);
    if (soldOutLooseItemIds.length > 0) {
      throw new ProductUnavailableError(soldOutLooseItemIds[0], 'sold_out', soldOutLooseItemIds);
    }

    // Promociones con algún componente caído.
    for (const comp of promotionComponents) {
      if (inactiveProductIds.has(comp.product_id) || soldOutProductIds.has(comp.product_id)) {
        badPromotionIds.add(comp.promotion_id);
      }
    }

    // Promociones que ya NO ahorran (regla del dinero revalidada al cobrar).
    const componentsByPromotion = new Map<string, { product_id: string; quantity: number }[]>();
    for (const c of promotionComponents) {
      const list = componentsByPromotion.get(c.promotion_id) ?? [];
      list.push(c);
      componentsByPromotion.set(c.promotion_id, list);
    }
    for (const [promotionId, comps] of componentsByPromotion) {
      const promo = promotionById.get(promotionId);
      if (!promo) continue; // ya está en badPromotionIds por "no encontrada"
      const regularTotal = comps.reduce(
        (sum, c) => sum + Number(productById.get(c.product_id)?.price ?? 0) * c.quantity,
        0,
      );
      if (regularTotal <= Number(promo.promo_price)) badPromotionIds.add(promotionId);
    }

    if (badPromotionIds.size > 0) {
      const list = [...badPromotionIds];
      throw new PromotionUnavailableError(list[0], 'unavailable', list);
    }

    // CÁLCULO. Todo desde la base, nada del cliente.
    let subtotal = 0;
    const itemLines = items.map((i) => {
      const product = productById.get(i.productId)!;
      const lineSubtotal = Number(product.price) * i.quantity;
      subtotal += lineSubtotal;
      return { product, quantity: i.quantity, subtotal: lineSubtotal };
    });

    const promotionLines = promotions.map((p) => {
      const promo = promotionById.get(p.promotionId)!;
      const lineSubtotal = Number(promo.promo_price) * p.quantity;
      subtotal += lineSubtotal;
      const comps = componentsByPromotion.get(p.promotionId) ?? [];
      const componentsSnapshot = comps.map((c) => {
        const product = productById.get(c.product_id)!;
        return {
          productId: product.id,
          code: product.code,
          name: product.name,
          unitPrice: Number(product.price),
          quantity: c.quantity,
        };
      });
      return { promo, quantity: p.quantity, subtotal: lineSubtotal, componentsSnapshot };
    });

    if (subtotal <= 0) {
      throw new ValidationError('El total del pedido debe ser positivo.');
    }

    // pickup (para llevar) y dine_in (mesa) no necesitan ubicación ni cotización: nacen confirmados.
    const needsDelivery = input.deliveryType === 'delivery';
    const initialStatus: OrderStatus = needsDelivery ? 'awaiting_location' : 'confirmed';
    const confirmedAt = needsDelivery ? null : now;
    const deliveryPricing = needsDelivery ? ('dynamic' as const) : null;
    const deliveryQuoteStatus = needsDelivery ? ('pending' as const) : null;

    const orderRow = await trx
      .insertInto('orders')
      .values({
        customer_id: input.customerId,
        channel: input.channel,
        customer_name: customerName,
        delivery_type: input.deliveryType,
        payment_method: input.paymentMethod,
        notes,
        status: initialStatus,
        subtotal_amount: subtotal.toFixed(2),
        total_amount: subtotal.toFixed(2),
        delivery_pricing: deliveryPricing,
        delivery_quote_status: deliveryQuoteStatus,
        confirmed_at: confirmedAt,
        register_session_id: input.registerSessionId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    if (itemLines.length > 0) {
      await trx
        .insertInto('order_items')
        .values(
          itemLines.map((line) => ({
            order_id: orderRow.id,
            product_id: line.product.id,
            product_code_snapshot: line.product.code,
            product_name_snapshot: line.product.name,
            unit_price_snapshot: line.product.price,
            quantity: line.quantity,
            subtotal: line.subtotal.toFixed(2),
          })),
        )
        .execute();
    }

    if (promotionLines.length > 0) {
      await trx
        .insertInto('order_promotions')
        .values(
          promotionLines.map((line) => ({
            order_id: orderRow.id,
            promotion_id: line.promo.id,
            promotion_name_snapshot: line.promo.name,
            promo_price_snapshot: line.promo.promo_price,
            combo_quantity: line.quantity,
            subtotal: line.subtotal.toFixed(2),
            components_snapshot: JSON.stringify(line.componentsSnapshot),
          })),
        )
        .execute();
    }

    const { items: insertedItems, promotions: insertedPromotions } = await loadOrderLines(
      trx,
      orderRow.id,
    );

    return toOrderResponse(orderRow, insertedItems, insertedPromotions);
  }

  /**
   * Ventana `late_review`: NO se llama a `createOrderInTransaction` — se
   * guarda el carrito crudo para revalidarlo por completo recién al aceptar
   * (`LateOrderRequestsService.accept`). Idempotencia propia por columna
   * única (mismo patrón que `delivery_quote_requests`), no la tabla
   * genérica `idempotency_keys`.
   */
  private async createLateOrderRequest(
    dto: CreateOrderDto,
    idempotencyKey: string,
    now: Date,
  ): Promise<LateOrderRequestAcceptedResponse> {
    const existing = await this.db
      .selectFrom('late_order_requests')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    if (existing) return toLateOrderRequestAcceptedResponse(existing);

    const items = dto.items;
    const promotions = dto.promotions ?? [];
    if (items.length + promotions.length < 1) {
      throw new ValidationError('El carrito está vacío.');
    }

    const productIds = items.map((i) => i.productId);
    const promotionIds = promotions.map((p) => p.promotionId);

    const products =
      productIds.length > 0
        ? await this.db.selectFrom('products').selectAll().where('id', 'in', productIds).execute()
        : [];
    const productById = new Map(products.map((p) => [p.id, p]));

    const promotionRows =
      promotionIds.length > 0
        ? await this.db
            .selectFrom('promotions')
            .selectAll()
            .where('id', 'in', promotionIds)
            .execute()
        : [];
    const promotionById = new Map(promotionRows.map((p) => [p.id, p]));

    // Subtotal informativo (best-effort, con precios de HOY): la validación
    // autoritativa completa se repite entera al aceptar, vía
    // createOrderInTransaction. Un producto/promo que ya no exista no revienta
    // la solicitud — solo no suma al subtotal mostrado; se rechazará como
    // 'order_unavailable' recién al intentar aceptar.
    let subtotal = 0;
    for (const item of items) {
      const product = productById.get(item.productId);
      if (product) subtotal += Number(product.price) * item.quantity;
    }
    for (const p of promotions) {
      const promo = promotionById.get(p.promotionId);
      if (promo) subtotal += Number(promo.promo_price) * p.quantity;
    }
    if (subtotal <= 0) {
      throw new ValidationError('El total del pedido debe ser positivo.');
    }

    const expiresAt = lateRequestExpiryFor(now);

    const inserted = await this.db
      .insertInto('late_order_requests')
      .values({
        customer_id: dto.customerId ?? null,
        customer_name: dto.customerName.trim(),
        channel: dto.channel,
        delivery_type: dto.deliveryType,
        payment_method: dto.paymentMethod,
        notes: dto.notes?.trim() || null,
        items_json: JSON.stringify(items),
        promotions_json: JSON.stringify(promotions),
        subtotal_amount: subtotal.toFixed(2),
        idempotency_key: idempotencyKey,
        expires_at: expiresAt,
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .returningAll()
      .executeTakeFirst();

    if (inserted) {
      try {
        await this.notifications.notifyNow({
          channel: 'telegram',
          kind: 'late_request_alert',
          targetRef: inserted.id,
          payload: {
            chatRef: 'staff-group',
            text: `Solicitud fuera de horario ${inserted.request_number} — ${inserted.customer_name}, total ${inserted.subtotal_amount}.`,
            buttons: [
              { label: 'Aceptar', action: `late-order-requests/${inserted.id}/accept` },
              { label: 'Rechazar', action: `late-order-requests/${inserted.id}/reject` },
            ],
          },
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo avisar al mostrador sobre ${inserted.id}: ${(error as Error).message}`,
        );
      }
      return toLateOrderRequestAcceptedResponse(inserted);
    }

    const winner = await this.db
      .selectFrom('late_order_requests')
      .selectAll()
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirstOrThrow();
    return toLateOrderRequestAcceptedResponse(winner);
  }

  async requestLocation(orderId: string): Promise<void> {
    const order = await this.db
      .selectFrom('orders')
      .select(['id', 'delivery_type', 'customer_id'])
      .where('id', '=', orderId)
      .executeTakeFirst();
    if (!order) throw new NotFoundDomainError('order', orderId);
    if (order.delivery_type !== 'delivery') {
      throw new ValidationError('El pedido no es de delivery.');
    }
    if (!order.customer_id) {
      throw new ValidationError('El pedido no tiene un cliente al cual pedirle ubicación.');
    }

    await this.notifications.notifyNow({
      channel: 'whatsapp',
      kind: 'location_request',
      targetRef: order.id,
      payload: { customerId: order.customer_id, reason: 'delivery_location' },
    });
  }

  /** Dispara la cotización de delivery atada al pedido (ver DeliveryService.quoteForOrder). */
  async attachLocation(
    orderId: string,
    location: { latitude: number; longitude: number },
  ): Promise<OrderResponse> {
    const order = await this.db
      .selectFrom('orders')
      .select([
        'id',
        'delivery_type',
        'status',
        'delivery_quote_status',
        'delivery_latitude',
        'delivery_longitude',
      ])
      .where('id', '=', orderId)
      .executeTakeFirst();
    if (!order) throw new NotFoundDomainError('order', orderId);
    if (order.delivery_type !== 'delivery') {
      throw new ValidationError('El pedido no es de delivery.');
    }

    if (order.delivery_latitude !== null && order.delivery_longitude !== null) {
      const sameLocation =
        order.delivery_latitude === location.latitude &&
        order.delivery_longitude === location.longitude;
      if (!sameLocation) {
        throw new DomainException(
          'location_already_attached',
          HttpStatus.CONFLICT,
          'El pedido ya tiene una ubicación distinta asociada.',
        );
      }

      if (
        order.status === 'awaiting_location' &&
        ['pending', 'failed'].includes(order.delivery_quote_status ?? '')
      ) {
        const retryQuote = await this.deliveryService.quoteForOrder(orderId);
        if (retryQuote.result === 'applied') {
          try {
            await this.qrCheckout.notifyIfReady(orderId);
          } catch (error) {
            this.logger.warn(
              `No se pudo preparar QR después de cotizar ${orderId}: ${(error as Error).message}`,
            );
          }
        }
      }
      return this.findById(orderId);
    }

    if (
      order.status !== 'awaiting_location' ||
      !['pending', 'failed'].includes(order.delivery_quote_status ?? '')
    ) {
      throw new DomainException(
        'location_not_expected',
        HttpStatus.CONFLICT,
        'El pedido ya no está esperando ubicación.',
      );
    }

    const updated = await this.db
      .updateTable('orders')
      .set({
        delivery_latitude: location.latitude,
        delivery_longitude: location.longitude,
        updated_at: new Date(),
      })
      .where('id', '=', orderId)
      .where('status', '=', 'awaiting_location')
      .where('delivery_latitude', 'is', null)
      .where('delivery_longitude', 'is', null)
      .returning('id')
      .executeTakeFirst();

    if (!updated) {
      const winner = await this.db
        .selectFrom('orders')
        .select(['delivery_latitude', 'delivery_longitude'])
        .where('id', '=', orderId)
        .executeTakeFirstOrThrow();

      if (
        winner.delivery_latitude === location.latitude &&
        winner.delivery_longitude === location.longitude
      ) {
        return this.findById(orderId);
      }

      throw new DomainException(
        'location_conflict',
        HttpStatus.CONFLICT,
        'La ubicación del pedido cambió antes de guardar este pin.',
      );
    }

    const quote = await this.deliveryService.quoteForOrder(orderId);
    if (quote.result === 'applied') {
      try {
        await this.qrCheckout.notifyIfReady(orderId);
      } catch (error) {
        this.logger.warn(
          `No se pudo preparar QR después de cotizar ${orderId}: ${(error as Error).message}`,
        );
      }
    }
    return this.findById(orderId);
  }

  async addKitchenNote(orderId: string, note: string): Promise<OrderResponse> {
    const trimmed = note.trim();
    if (!trimmed) throw new ValidationError('La nota no puede estar vacía.');

    return this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new NotFoundDomainError('order', orderId);
      if (order.status !== 'confirmed') {
        throw new DomainException(
          'kitchen_note_locked',
          HttpStatus.CONFLICT,
          'El pedido ya no admite cambios de cocina.',
          { status: order.status },
        );
      }

      const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();
      if (order.notes && normalize(order.notes).includes(normalize(trimmed))) {
        const { items, promotions } = await loadOrderLines(trx, orderId);
        return toOrderResponse(order, items, promotions);
      }

      const combined = order.notes ? `${order.notes}\n${trimmed}` : trimmed;
      if (combined.length > 500) {
        throw new ValidationError('Las notas admiten como máximo 500 caracteres en total.');
      }

      const updated = await trx
        .updateTable('orders')
        .set({ notes: combined, updated_at: new Date() })
        .where('id', '=', orderId)
        .where('status', '=', 'confirmed')
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new DomainException(
          'kitchen_note_conflict',
          HttpStatus.CONFLICT,
          'El pedido cambió antes de guardar la nota.',
        );
      }

      const { items, promotions } = await loadOrderLines(trx, orderId);
      return toOrderResponse(updated, items, promotions);
    });
  }

  async switchToPickup(orderId: string): Promise<OrderResponse> {
    const settings = await this.operationalSettings.getRow();
    if (!settings.pickup_enabled) {
      throw new DomainException(
        'pickup_disabled',
        HttpStatus.CONFLICT,
        'El recojo en local está deshabilitado temporalmente.',
      );
    }

    const response = await this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new NotFoundDomainError('order', orderId);
      if (order.delivery_type !== 'delivery') {
        throw new ValidationError(`El pedido ya es ${order.delivery_type}, no es un delivery.`);
      }
      if (order.delivery_quote_status === 'quoted') {
        throw new DomainException(
          'delivery_already_quoted',
          HttpStatus.CONFLICT,
          'No se puede cambiar a pickup: el delivery ya fue cotizado y confirmado.',
        );
      }

      const totalAmount = Number(order.subtotal_amount);
      const updated = await trx
        .updateTable('orders')
        .set({
          delivery_type: 'pickup',
          delivery_pricing: null,
          delivery_quote_status: null,
          delivery_distance_meters: null,
          delivery_latitude: null,
          delivery_longitude: null,
          delivery_base_amount: '0',
          delivery_surcharge_amount: '0',
          total_amount: totalAmount.toFixed(2),
          status: 'confirmed',
          confirmed_at: order.confirmed_at ?? new Date(),
          updated_at: new Date(),
        })
        .where('id', '=', orderId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const { items, promotions } = await loadOrderLines(trx, orderId);
      return toOrderResponse(updated, items, promotions);
    });

    try {
      await this.qrCheckout.notifyIfReady(orderId);
    } catch (error) {
      this.logger.warn(
        `No se pudo preparar QR al cambiar ${orderId} a pickup: ${(error as Error).message}`,
      );
    }
    return response;
  }

  /**
   * CAS sobre cash_confirmed_at (invariante 5): el efecto (avisar grupo de
   * delivery, luego al cliente) solo se dispara si ESTA llamada ganó el CAS.
   *
   * Vincula el pedido a la caja abierta en este momento (invariante de
   * caja: la plata se atribuye al turno en que entra de verdad) — salvo que
   * ya venga vinculado (pedido fuera de horario, se etiquetó al aceptarse).
   * Por eso deja de ser un UPDATE suelto y pasa a `SELECT ... FOR UPDATE` +
   * transacción, igual que `switchToPickup`.
   */
  async confirmCash(orderId: string): Promise<OrderResponse> {
    const updated = await this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirst();
      if (!order) throw new NotFoundDomainError('order', orderId);
      if (order.payment_method !== 'cash') {
        throw new ValidationError('El pedido no es de pago en efectivo.');
      }
      if (order.cash_confirmed_at !== null) return null; // ya confirmado, comportamiento idempotente de abajo

      const registerSessionId = order.register_session_id ?? (await this.cashRegister.assertOpenSessionId(trx));

      return trx
        .updateTable('orders')
        .set({
          cash_confirmed_at: new Date(),
          payment_status: 'paid',
          register_session_id: registerSessionId,
          updated_at: new Date(),
        })
        .where('id', '=', orderId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    if (!updated) {
      const existing = await this.findExistingCashOrder(orderId);
      const { items, promotions } = await loadOrderLines(this.db, existing.id);
      return toOrderResponse(existing, items, promotions);
    }

    try {
      if (updated.delivery_type === 'delivery') {
        await this.notifications.notifyNow({
          channel: 'telegram',
          kind: 'cash_confirmed_delivery_notice',
          targetRef: updated.id,
          payload: {
            chatRef: 'delivery-group',
            text: `Pedido ${updated.order_number} confirmado en efectivo.`,
          },
        });
      }
      if (updated.customer_id) {
        await this.notifications.notifyNow({
          channel: 'whatsapp',
          kind: 'cash_confirmed_customer_notice',
          targetRef: updated.id,
          payload: {
            customerId: updated.customer_id,
            text: `Tu pago en efectivo para el pedido ${updated.order_number} fue confirmado.`,
          },
        });
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo notificar cash confirm para ${updated.id}: ${(error as Error).message}`,
      );
    }

    const { items, promotions } = await loadOrderLines(this.db, updated.id);
    return toOrderResponse(updated, items, promotions);
  }

  async cancelCash(orderId: string): Promise<OrderResponse> {
    const updated = await this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('orders')
        .selectAll()
        .where('id', '=', orderId)
        .forUpdate()
        .executeTakeFirst();

      if (!order) throw new NotFoundDomainError('order', orderId);
      if (order.payment_method !== 'cash') {
        throw new ValidationError('El pedido no es de pago en efectivo.');
      }
      if (order.status === 'cancelled') return order;
      if (order.cash_confirmed_at !== null) {
        throw new DomainException(
          'cash_order_already_confirmed',
          HttpStatus.CONFLICT,
          'El pedido en efectivo ya fue confirmado y no puede cancelarse automáticamente.',
        );
      }
      if (!['awaiting_location', 'confirmed'].includes(order.status)) {
        throw new DomainException(
          'cash_order_not_cancellable',
          HttpStatus.CONFLICT,
          `El pedido no puede cancelarse en estado ${order.status}.`,
        );
      }

      return trx
        .updateTable('orders')
        .set({
          status: 'cancelled',
          status_updated_by: 'customer_cash_cancel',
          updated_at: new Date(),
        })
        .where('id', '=', orderId)
        .where('cash_confirmed_at', 'is', null)
        .where('status', '=', order.status)
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    if (updated.customer_id && updated.status === 'cancelled') {
      try {
        await this.notifications.notifyNow({
          channel: 'whatsapp',
          kind: 'cash_cancelled_customer_notice',
          targetRef: updated.id,
          payload: {
            customerId: updated.customer_id,
            text: `Tu pedido ${updated.order_number} fue cancelado.`,
          },
        });
      } catch (error) {
        this.logger.warn(
          `No se pudo notificar cash cancel para ${updated.id}: ${(error as Error).message}`,
        );
      }
    }

    const { items, promotions } = await loadOrderLines(this.db, updated.id);
    return toOrderResponse(updated, items, promotions);
  }

  private async findExistingCashOrder(orderId: string) {
    const existing = await this.db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', orderId)
      .executeTakeFirst();
    if (!existing) throw new NotFoundDomainError('order', orderId);
    if (existing.payment_method !== 'cash') {
      throw new ValidationError('El pedido no es de pago en efectivo.');
    }
    return existing;
  }

  /**
   * PATCH /orders/:id/status — transición legal + CAS optimista. `updatedBy`
   * es el username del staff autenticado (tablero de cocina, JWT) — queda
   * guardado en `status_updated_by` para saber quién movió el pedido.
   *
   * Pago contra entrega SOLO existe para delivery + cash (el repartidor
   * cobra en la puerta) — ahí `preparing` no exige `paid` todavía. Todo lo
   * demás (pickup/POS, y delivery con QR — un QR no se "entrega") sí exige
   * `payment_status: 'paid'` antes de `-> preparing`, porque en esos casos
   * el pago siempre se confirma ANTES de que cocina empiece.
   */
  async updateStatus(
    orderId: string,
    to: OrderStatus,
    updatedBy: string | null,
  ): Promise<OrderResponse> {
    const order = await this.db
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', orderId)
      .executeTakeFirst();
    if (!order) throw new NotFoundDomainError('order', orderId);

    const allowed = ORDER_STATUS_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(to)) {
      throw new InvalidStateTransitionError('order', order.status, to);
    }

    const isCashOnDelivery = order.delivery_type === 'delivery' && order.payment_method === 'cash';
    if (to === 'preparing' && !isCashOnDelivery && order.payment_status !== 'paid') {
      throw new DomainException(
        'payment_required',
        HttpStatus.CONFLICT,
        'El pedido debe estar pagado antes de empezar a prepararse.',
        { paymentStatus: order.payment_status },
      );
    }

    const updated = await this.db
      .updateTable('orders')
      .set({ status: to, status_updated_by: updatedBy, updated_at: new Date() })
      .where('id', '=', orderId)
      .where('status', '=', order.status)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      throw new DomainException(
        'status_conflict',
        HttpStatus.CONFLICT,
        'El estado del pedido cambió antes de aplicar esta transición; reintenta.',
      );
    }

    if (to === 'cancelled' && order.payment_method === 'qr') {
      this.qrPayments
        .cancelForOrder(orderId)
        .catch((error: Error) =>
          this.logger.warn(`No se pudo cancelar el QR bancario de ${orderId}: ${error.message}`),
        );
    }

    const { items, promotions } = await loadOrderLines(this.db, orderId);
    return toOrderResponse(updated, items, promotions);
  }
}

function toLateOrderRequestAcceptedResponse(row: {
  id: string;
  request_number: string;
  subtotal_amount: string;
  expires_at: Date | string;
}): LateOrderRequestAcceptedResponse {
  return {
    requestId: row.id,
    requestNumber: row.request_number,
    status: 'pending',
    subtotalAmount: Number(row.subtotal_amount),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

function groupByOrderId<T extends { order_id: string }>(rows: T[]): Map<string, T[]> {
  const byOrder = new Map<string, T[]>();
  for (const row of rows) {
    const list = byOrder.get(row.order_id) ?? [];
    list.push(row);
    byOrder.set(row.order_id, list);
  }
  return byOrder;
}

/** Transaction<Database> extiende Kysely<Database>, así que sirve dentro y fuera de una transacción. */
async function loadOrderLines(db: Kysely<Database>, orderId: string) {
  const items = await db
    .selectFrom('order_items')
    .selectAll()
    .where('order_id', '=', orderId)
    .execute();
  const promotions = await db
    .selectFrom('order_promotions')
    .selectAll()
    .where('order_id', '=', orderId)
    .execute();
  return { items, promotions };
}

function toOrderResponse(
  order: {
    id: string;
    order_number: string;
    customer_id: string | null;
    channel: string;
    customer_name: string;
    delivery_type: string;
    payment_method: string;
    payment_status: string;
    notes: string | null;
    status: string;
    subtotal_amount: string;
    delivery_base_amount: string;
    delivery_surcharge_amount: string;
    total_amount: string;
    delivery_quote_status: string | null;
    delivery_distance_meters: number | null;
    cash_confirmed_at: Date | string | null;
    status_updated_by: string | null;
    created_at: Date | string;
  },
  items: {
    product_id: string;
    product_code_snapshot: string;
    product_name_snapshot: string;
    unit_price_snapshot: string;
    quantity: number;
    subtotal: string;
  }[],
  promotions: {
    promotion_id: string | null;
    promotion_name_snapshot: string;
    promo_price_snapshot: string;
    combo_quantity: number;
    subtotal: string;
    components_snapshot: OrderPromotionComponentSnapshot[];
  }[],
): OrderResponse {
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerId: order.customer_id,
    channel: order.channel,
    customerName: order.customer_name,
    deliveryType: order.delivery_type,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    notes: order.notes,
    status: order.status,
    subtotalAmount: Number(order.subtotal_amount),
    deliveryBaseAmount: Number(order.delivery_base_amount),
    deliverySurchargeAmount: Number(order.delivery_surcharge_amount),
    totalAmount: Number(order.total_amount),
    deliveryQuoteStatus: order.delivery_quote_status,
    deliveryDistanceMeters: order.delivery_distance_meters,
    cashConfirmedAt: order.cash_confirmed_at
      ? new Date(order.cash_confirmed_at).toISOString()
      : null,
    statusUpdatedBy: order.status_updated_by,
    createdAt: new Date(order.created_at).toISOString(),
    items: items.map((item) => ({
      productId: item.product_id,
      productCodeSnapshot: item.product_code_snapshot,
      productNameSnapshot: item.product_name_snapshot,
      unitPriceSnapshot: Number(item.unit_price_snapshot),
      quantity: item.quantity,
      subtotal: Number(item.subtotal),
    })),
    promotions: promotions.map((promotion) => ({
      promotionId: promotion.promotion_id,
      promotionNameSnapshot: promotion.promotion_name_snapshot,
      promoPriceSnapshot: Number(promotion.promo_price_snapshot),
      comboQuantity: promotion.combo_quantity,
      subtotal: Number(promotion.subtotal),
      componentsSnapshot: promotion.components_snapshot,
    })),
  };
}
