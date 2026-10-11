/**
 * Creación del pedido web en el backend central — sin `server-only`.
 *
 * Sustituye a la RPC `create_order_web_v4` cuando el backend central está
 * activado: el pedido nace en la misma base que usa el POS, así que aparece en
 * su cocina, en su caja y en sus reportes sin ningún paso de sincronización.
 *
 * Devuelve lo mismo que devolvía la RPC (`CreateOrderWebOutcome`), con los
 * mismos códigos para los mismos casos. Así `handleCreateWebOrder` —y todo lo
 * que el navegador ya sabe mostrar— sigue igual, y lo único que cambia es quién
 * escribe el pedido.
 *
 * Las dependencias se inyectan, como en `web-checkout`: se prueba sin red.
 */
import type {
  CreateOrderWebOutcome,
  CreateOrderWebParams,
  CreateOrderWebRow,
} from '@/lib/orders/web-checkout';
import type { OrderStatus, PaymentMethod } from '@/types';
import type { CentralProduct } from './catalog';

/** Lo mínimo de `centralRequest` que hace falta aquí. */
export type CentralRequestFn = <T>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> },
) => Promise<{ status: number; body: T }>;

/** Error del backend tal como lo lanza `centralRequest` (ver `CentralApiError`). */
interface CentralErrorLike {
  status: number;
  code: string;
  details?: unknown;
}

function isCentralError(error: unknown): error is CentralErrorLike {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as CentralErrorLike).code === 'string' &&
    typeof (error as CentralErrorLike).status === 'number'
  );
}

/** El pedido tal como lo devuelve `POST /orders` (solo lo que se lee). */
export interface CentralOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  deliveryType: string;
  paymentMethod: string;
  status: string;
  subtotalAmount: number;
  deliveryBaseAmount: number;
  deliverySurchargeAmount: number;
  totalAmount: number;
  createdAt: string;
}

export interface CentralOrderDeps {
  request: CentralRequestFn;
  /**
   * Teléfono del cliente dueño de la sesión del menú (solo dígitos, como lo
   * guarda `menu_sessions`), o `null` si la sesión ya no existe.
   */
  findSessionPhone(menuSessionId: string): Promise<string | null>;
}

/**
 * Códigos propios de este camino, además de los SQLSTATE de la RPC que se
 * reutilizan (`P1001`…`P1004`). `mapRpcError` los traduce a lo que ve el cliente.
 */
export const CENTRAL_CLOSED = 'central_closed';
export const CENTRAL_PAUSED = 'central_paused';
export const CENTRAL_PENDING_REVIEW = 'central_pending_review';
export const CENTRAL_PICKUP_DISABLED = 'central_pickup_disabled';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Una clave por ENLACE, no por carrito.
 *
 * Es lo que conserva la regla de siempre —un enlace, un pedido— sin guardar
 * nada del lado del agente: el mismo carrito repetido devuelve el pedido que ya
 * existía (200), y un carrito distinto con el mismo enlace choca con
 * `idempotency_key_reused`, que aquí es "este enlace ya fue utilizado".
 *
 * Si el pedido NO llegó a crearse (un producto agotado, por ejemplo) el backend
 * no guarda la clave, así que el cliente puede corregir el carrito y reintentar.
 */
export function idempotencyKeyFor(menuSessionId: string): string {
  return `menu-session:${menuSessionId}`;
}

/** `menu_sessions` guarda solo dígitos; el backend identifica al cliente en E.164. */
export function toE164(phoneDigits: string): string {
  return `+${phoneDigits.replace(/\D/g, '')}`;
}

function toAgentStatus(status: string): OrderStatus {
  // El backend dice `out_for_delivery`; el agente siempre lo llamó `on_the_way`.
  return (status === 'out_for_delivery' ? 'on_the_way' : status) as OrderStatus;
}

function toRow(order: CentralOrder, created: boolean): CreateOrderWebRow {
  return {
    order_id: order.id,
    order_number: order.orderNumber,
    customer_name: order.customerName,
    delivery_type: order.deliveryType === 'delivery' ? 'delivery' : 'pickup',
    status: toAgentStatus(order.status),
    subtotal_amount: order.subtotalAmount,
    delivery_amount: order.deliveryBaseAmount + order.deliverySurchargeAmount,
    total_amount: order.totalAmount,
    payment_method: order.paymentMethod as PaymentMethod,
    created_at: order.createdAt,
    created,
  };
}

function failure(errorCode: string, errorMessage: string | null = null): CreateOrderWebOutcome {
  return { data: null, errorCode, errorMessage };
}

/** Traduce un error del backend al código que `mapRpcError` ya sabe explicar. */
function mapCentralError(error: CentralErrorLike): CreateOrderWebOutcome {
  switch (error.code) {
    case 'product_unavailable':
      return failure('P1002');
    case 'promotion_unavailable': {
      const details = (error.details ?? {}) as { promotionId?: unknown; reason?: unknown };
      const id = typeof details.promotionId === 'string' && UUID.test(details.promotionId) ? details.promotionId : null;
      const reason = typeof details.reason === 'string' ? details.reason : 'not_found';
      // Mismo formato cerrado que escribía la RPC; sin id reconocible cae al
      // error genérico, que es lo que hacía un P1004 ilegible.
      return failure('P1004', id ? `promotion_rejected:${reason}:${id}` : null);
    }
    case 'idempotency_key_reused':
      return failure('P1003');
    case 'closed':
      return failure(CENTRAL_CLOSED);
    case 'orders_paused':
      return failure(CENTRAL_PAUSED);
    case 'pickup_disabled':
      return failure(CENTRAL_PICKUP_DISABLED);
    default:
      // 400 del backend = el cuerpo no pasó su validación.
      if (error.status === 400) return failure('22023');
      return failure(error.code);
  }
}

/**
 * Crea el pedido en el backend central a partir del carrito ya validado.
 *
 * Nunca lanza por un rechazo de negocio: lo devuelve como `errorCode`. Solo
 * deja subir lo inesperado, que `handleCreateWebOrder` ya convierte en un 500
 * sin detalle.
 */
export async function createCentralWebOrder(
  params: CreateOrderWebParams,
  deps: CentralOrderDeps,
): Promise<CreateOrderWebOutcome> {
  const phone = await deps.findSessionPhone(params.p_menu_session_id);
  if (!phone) return failure('P1001');

  try {
    // El carrito habla en `code`; el backend, en id. Se resuelve contra el
    // catálogo vigente: un código que ya no está es un producto que ya no se vende.
    const products = await deps.request<CentralProduct[]>('/products');
    const idByCode = new Map(products.body.map((product) => [product.code, product.id]));
    const items: Array<{ productId: string; quantity: number }> = [];
    for (const line of params.p_items_json) {
      const productId = idByCode.get(line.code);
      if (!productId) return failure('P1002');
      items.push({ productId, quantity: line.quantity });
    }

    const customer = await deps.request<{ id: string }>('/customers/find-or-create', {
      method: 'POST',
      body: { phone: toE164(phone), name: params.p_customer_name },
    });

    const response = await deps.request<CentralOrder | { requestId?: string }>('/orders', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKeyFor(params.p_menu_session_id) },
      body: {
        customerId: customer.body.id,
        channel: 'whatsapp',
        customerName: params.p_customer_name,
        deliveryType: params.p_delivery_type,
        paymentMethod: params.p_payment_method,
        ...(params.p_notes ? { notes: params.p_notes } : {}),
        items,
        promotions: params.p_promotions_json.map((promotion) => ({
          promotionId: promotion.promotion_id,
          quantity: promotion.quantity,
          // El backend exige el testigo; sin él se manda 0, que nunca coincide
          // y hace que el cliente recargue para ver la promoción vigente.
          revision: promotion.revision ?? 0,
        })),
      },
    });

    // 202: no hay caja abierta. El backend no crea el pedido: deja una
    // solicitud para que el personal la acepte o la rechace desde el POS.
    if (response.status === 202) return failure(CENTRAL_PENDING_REVIEW);

    return { data: toRow(response.body as CentralOrder, response.status === 201), errorCode: null };
  } catch (error) {
    if (isCentralError(error) && error.status > 0) return mapCentralError(error);
    throw error;
  }
}
