/**
 * CONTRATO DEL POS, versión 1 — módulo PURO.
 *
 * Todo lo que viaja entre el agente y el POS, en las dos direcciones: rutas,
 * cuerpos, respuestas y códigos de error. La versión para personas es
 * `docs/pos-contract.md`; este archivo es la misma cosa para el compilador, y
 * `scripts/check-pos-contract.mjs` la comprueba contra un POS de verdad. Si
 * cambia una de las tres, cambian las tres.
 *
 * ── Quién puede importar esto ────────────────────────────────────────────────
 *
 * Cualquiera: no tiene `server-only`, ni red, ni imports del resto del agente.
 * Lo que NO puede hacer el resto del agente es importar los demás archivos de
 * esta carpeta: entra por `@/lib/central` (las funciones) o por
 * `@/lib/central/contract` (estos tipos). ESLint lo exige.
 *
 * ── La regla del contrato ───────────────────────────────────────────────────
 *
 * El restaurante sale del token. Ninguna ruta ni cuerpo lleva `restaurantId`:
 * un agente solo puede ver y tocar el restaurante de su `CENTRAL_API_TOKEN`.
 */

export const POS_CONTRACT_VERSION = 'v1';

// ── Enumeraciones ───────────────────────────────────────────────────────────

export type PosChannel = 'whatsapp' | 'web' | 'pos';
export type PosDeliveryType = 'delivery' | 'pickup' | 'dine_in';
export type PosPaymentMethod = 'cash' | 'qr' | 'card';
export type PosOrderStatus =
  | 'draft'
  | 'awaiting_location'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';
export type PosPaymentStatus =
  | 'unpaid'
  | 'pending_review'
  | 'paid'
  | 'rejected'
  | 'paid_unapplied'
  | 'refunded';
export type PosDeliveryQuoteStatus = 'pending' | 'quoted' | 'pending_manual' | 'failed';

/** Los estados en los que un pedido cuenta como "en curso" para `active-order`. */
export const POS_ACTIVE_ORDER_STATUSES: readonly PosOrderStatus[] = [
  'awaiting_location',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
];

// ── Rutas ───────────────────────────────────────────────────────────────────

/** Lo que el agente llama en el POS. Se anteponen a `CENTRAL_API_BASE_URL`. */
export const POS_ROUTES = {
  restaurantProfile: '/restaurant/profile',
  categories: '/categories',
  products: '/products',
  productImage: (productId: string) => `/products/${productId}/image`,
  promotions: '/promotions',
  findOrCreateCustomer: '/customers/find-or-create',
  activeOrder: (customerId: string) => `/customers/${customerId}/active-order`,
  orders: '/orders',
  order: (orderId: string) => `/orders/${orderId}`,
  orderLocation: (orderId: string) => `/orders/${orderId}/location`,
  orderCashConfirm: (orderId: string) => `/orders/${orderId}/cash/confirm`,
  orderCashCancel: (orderId: string) => `/orders/${orderId}/cash/cancel`,
  // Ampliación de la v1: el agente las adopta en la Fase 4.
  orderReplace: (orderId: string) => `/orders/${orderId}/replace`,
  orderKitchenNote: (orderId: string) => `/orders/${orderId}/kitchen-note`,
  orderSwitchToPickup: (orderId: string) => `/orders/${orderId}/switch-to-pickup`,
  deliveryQuotes: '/delivery/quotes',
  paymentProofs: '/payment-proofs',
  paymentProofAnalysis: (proofId: string) => `/payment-proofs/${proofId}/analysis`,
  /** Un toque del personal: la `action` del botón ES la ruta (ver `STAFF_ACTION_PATTERN`). */
  staffAction: (action: string) => `/${action}`,
} as const;

/**
 * Lo que el POS llama en el agente. Se anteponen a la URL del gateway que el
 * POS guarda para ese restaurante (en este agente, `<APP_BASE_URL>/api`).
 */
export const GATEWAY_ROUTES = {
  whatsappMessages: '/gateway/whatsapp/messages',
  whatsappLocationRequests: '/gateway/whatsapp/location-requests',
  telegramAlerts: '/gateway/telegram/alerts',
} as const;

/** Cabecera obligatoria en `POST /orders`, `/replace` y `/delivery/quotes`. */
export const IDEMPOTENCY_HEADER = 'idempotency-key';

// ── Errores ─────────────────────────────────────────────────────────────────

/** Forma de TODO error del POS. `message` es para depurar, no para el cliente. */
export interface PosErrorBody {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

/**
 * Los `code` sobre los que el agente decide algo. El POS puede devolver otros;
 * el agente los trata como un fallo genérico.
 */
export const POS_ERROR = {
  validation: 'validation_error',
  notFound: 'not_found',
  // Crear o reemplazar un pedido
  closed: 'closed',
  ordersPaused: 'orders_paused',
  pickupDisabled: 'pickup_disabled',
  deliveryDisabled: 'delivery_disabled',
  paymentMethodDisabled: 'payment_method_disabled',
  productUnavailable: 'product_unavailable',
  promotionUnavailable: 'promotion_unavailable',
  idempotencyKeyReused: 'idempotency_key_reused',
  idempotencyInProgress: 'idempotency_in_progress',
  customerIdentityConflict: 'customer_identity_conflict',
  orderNotReplaceable: 'order_not_replaceable',
  orderPaymentInProgress: 'order_payment_in_progress',
  // Ubicación
  locationAlreadyAttached: 'location_already_attached',
  locationNotExpected: 'location_not_expected',
  locationConflict: 'location_conflict',
  // Efectivo
  cashOrderAlreadyConfirmed: 'cash_order_already_confirmed',
  cashOrderNotCancellable: 'cash_order_not_cancellable',
  cashRegisterClosed: 'cash_register_closed',
  // Nota de cocina y cambio a retiro
  kitchenNoteLocked: 'kitchen_note_locked',
  kitchenNoteConflict: 'kitchen_note_conflict',
  deliveryAlreadyQuoted: 'delivery_already_quoted',
  // Comprobantes
  paymentProofNoMatch: 'payment_proof_no_match',
  paymentProofAnalysisAlreadyRecorded: 'payment_proof_analysis_already_recorded',
  // Acciones del personal desde Telegram
  orderNotFirm: 'order_not_firm',
  invalidStateTransition: 'invalid_state_transition',
  staffActionsDisabled: 'staff_actions_disabled',
  // Fotos
  productImageNotSet: 'product_image_not_set',
} as const;

export type PosErrorCode = (typeof POS_ERROR)[keyof typeof POS_ERROR];

// ── Perfil del restaurante ──────────────────────────────────────────────────

export interface CentralDayHours {
  /** `HH:MM`, 24 horas, en la zona horaria del restaurante. */
  opens: string;
  /** `HH:MM`. Menor o igual que `opens` = termina al día siguiente; igual = 24 horas. */
  closes: string;
}

/** `GET /restaurant/profile`: lo que el agente dice del local. */
export interface CentralRestaurantProfile {
  contractVersion: string;
  name: string;
  /** Qué vende y dónde, en una línea. */
  description: string | null;
  /** BCP 47 (`es-BO`): idioma en que se le habla al cliente. */
  locale: string;
  /** Zona IANA (`America/La_Paz`). */
  timezone: string;
  /** ISO 4217 y el símbolo tal como lo ve el cliente (`BOB`, `Bs`). */
  currency: { code: string; symbol: string };
  /** Teléfono del local para el cliente, en E.164. */
  phone: string | null;
  location: {
    address: string | null;
    mapsUrl: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  hours: {
    /** El horario en palabras, para repetirlo tal cual. `null` = se arma de `weekly`. */
    text: string | null;
    /** Siete entradas, de domingo (0) a sábado (6). `null` = ese día no abre. */
    weekly: Array<CentralDayHours | null>;
  };
  ordering: {
    /** Pausa temporal de pedidos nuevos (cocina saturada). */
    paused: boolean;
    pickupEnabled: boolean;
    deliveryEnabled: boolean;
    /** Las formas de pago que se le ofrecen al cliente, en el orden a mostrar. */
    paymentMethods: PosPaymentMethod[];
  };
  messages: { greeting: string | null; farewell: string | null };
  /** Cabecera del mensaje del menú: video (MP4 H.264 Baseline) o imagen. */
  menuMedia: { videoUrl: string | null; imageUrl: string | null };
}

// ── Catálogo ────────────────────────────────────────────────────────────────

export interface CentralCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CentralProduct {
  id: string;
  /** Código estable y legible del producto (`cafe_latte`). Único por restaurante. */
  code: string;
  name: string;
  description: string | null;
  categoryId: string;
  price: number;
  isActive: boolean;
  /** `false` = agotado: se enseña, pero no se puede pedir. */
  isAvailable: boolean;
  sortOrder: number;
  /** Ruta relativa al POS (`/products/:id/image`) o `null`. Nunca una URL pública. */
  imageUrl: string | null;
}

export interface CentralPromotionItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface CentralPromotion {
  id: string;
  name: string;
  description: string | null;
  promoPrice: number;
  isActive: boolean;
  archivedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  imageUrl: string | null;
  /** Testigo de versión: vuelve en `POST /orders` para no cobrar términos que el cliente no vio. */
  revision: number;
  items: CentralPromotionItem[];
}

// ── Clientes ────────────────────────────────────────────────────────────────

export interface CentralFindOrCreateCustomerBody {
  /** E.164, con `+`. */
  phone: string;
  name?: string;
}

export interface CentralCustomer {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
}

// ── Pedidos ─────────────────────────────────────────────────────────────────

export interface CentralOrderItemInput {
  productId: string;
  /** 1 a 10. */
  quantity: number;
}

export interface CentralOrderPromotionInput {
  promotionId: string;
  /** 1 a 10. */
  quantity: number;
  revision: number;
}

export interface CentralCreateOrderBody {
  customerId: string;
  channel: PosChannel;
  customerName: string;
  deliveryType: PosDeliveryType;
  paymentMethod: PosPaymentMethod;
  notes?: string;
  items: CentralOrderItemInput[];
  promotions?: CentralOrderPromotionInput[];
}

export interface CentralOrderItem {
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  subtotal: number;
}

export interface CentralOrderPromotion {
  promotionId: string | null;
  promotionNameSnapshot: string;
  promoPriceSnapshot: number;
  comboQuantity: number;
  subtotal: number;
  componentsSnapshot: Array<{
    productId: string;
    code: string;
    name: string;
    unitPrice: number;
    quantity: number;
  }>;
}

/** El pedido tal como lo devuelven `POST /orders`, `/location`, `/cash/*` y `GET /orders/:id`. */
export interface CentralOrder {
  id: string;
  /** Número que ve el cliente (`ORD-000123`). */
  orderNumber: string;
  customerId: string | null;
  channel: PosChannel;
  customerName: string;
  deliveryType: PosDeliveryType;
  paymentMethod: PosPaymentMethod;
  paymentStatus: PosPaymentStatus;
  status: PosOrderStatus;
  notes: string | null;
  subtotalAmount: number;
  deliveryBaseAmount: number;
  deliverySurchargeAmount: number;
  /** `subtotalAmount + deliveryBaseAmount + deliverySurchargeAmount`. */
  totalAmount: number;
  deliveryQuoteStatus: PosDeliveryQuoteStatus | null;
  deliveryDistanceMeters: number | null;
  cashConfirmedAt: string | null;
  createdAt: string;
  items: CentralOrderItem[];
  promotions: CentralOrderPromotion[];
}

/** Cuerpo del `202` de `POST /orders`: el pedido NO se creó, espera a una persona. */
export interface CentralPendingOrderRequest {
  requestId: string;
  requestNumber: string;
  status: 'pending';
  subtotalAmount: number;
  expiresAt: string;
}

/** `GET /customers/:id/active-order`. El cuerpo es `null` si no hay pedido en curso. */
export interface CentralActiveOrder {
  orderId: string;
  orderNumber: string;
  status: PosOrderStatus;
  paymentStatus: PosPaymentStatus;
  paymentMethod: PosPaymentMethod;
  totalAmount: number;
  subtotalAmount: number;
  deliveryType: PosDeliveryType;
  deliveryQuoteStatus: PosDeliveryQuoteStatus | null;
  cashConfirmed: boolean;
  locationReceived: boolean;
  proofReceived: boolean;
  latestPaymentAttempt: {
    reviewStatus: 'pending_review' | 'accepted' | 'rejected';
    reviewedAt: string | null;
  } | null;
  createdAt: string;
}

export interface CentralAttachLocationBody {
  latitude: number;
  longitude: number;
}

// ── Ampliación de la v1 (Fase 4) ────────────────────────────────────────────

/** `POST /orders/:id/replace`: el cliente rearma un pedido que aún se puede cambiar. */
export interface CentralReplaceOrderBody {
  channel: PosChannel;
  deliveryType: PosDeliveryType;
  paymentMethod: PosPaymentMethod;
  notes?: string;
  items: CentralOrderItemInput[];
  promotions?: CentralOrderPromotionInput[];
}

export interface CentralReplaceOrderResult {
  replacedOrderId: string;
  order: CentralOrder;
}

export interface CentralKitchenNoteBody {
  /** 1 a 500 caracteres. */
  note: string;
}

/** `POST /delivery/quotes`: cotizar un punto sin pedido ("¿cuánto sale el envío hasta aquí?"). */
export interface CentralDeliveryQuoteBody {
  customerId?: string;
  latitude: number;
  longitude: number;
}

export interface CentralDeliveryQuote {
  id: string;
  /** `manual_quote` = fuera del tarifario: lo cotiza una persona. */
  status: 'quoted' | 'manual_quote' | 'failed';
  distanceMeters: number | null;
  feeAmount: number | null;
  errorCode: string | null;
}

/** `POST /payment-proofs`: la foto del comprobante que mandó el cliente. */
export interface CentralPaymentProofBody {
  customerId: string;
  /** Id del mensaje de WhatsApp de la foto: es la barrera de idempotencia. */
  sourceMessageId: string;
  /** Id del mensaje al que el cliente respondió, si respondió a uno. */
  contextMessageId?: string;
  mimeType: string;
  /** Bytes del archivo en base64. Falta si no se pudo descargar la foto. */
  fileBase64?: string;
  /** Cuándo llegó el mensaje (ISO 8601). */
  receivedAt?: string;
}

export interface CentralPaymentProof {
  id: string;
  orderId: string | null;
  customerId: string | null;
  attemptId: string | null;
  matchMethod: string;
  routingException: string | null;
  captureStatus: string;
  analysisStatus: string;
  createdAt: string;
}

export type CentralProofVerdict = 'ok' | 'suspicious' | 'unreadable';
export type CentralProofReason =
  | 'account_mismatch'
  | 'holder_mismatch'
  | 'bank_mismatch'
  | 'reference_reused'
  | 'stale_receipt'
  | 'not_a_receipt'
  | 'unreadable'
  | 'amount_mismatch';
export type CentralProofAmountLabel = 'pago_total' | 'pago_productos' | 'revisar_monto';

/** `POST /payment-proofs/:id/analysis`: lo que leyó la visión. Informa, no decide. */
export type CentralPaymentProofAnalysisBody =
  | { status: 'failed' }
  | {
      status: 'ok';
      verdict: CentralProofVerdict;
      reasons: CentralProofReason[];
      amount?: number | null;
      amountLabel?: CentralProofAmountLabel | null;
      reference?: string | null;
      model?: string | null;
      destinationAccount?: string | null;
      destinationHolder?: string | null;
      destinationBank?: string | null;
    };

// ── Gateway: lo que el POS le pide al agente ────────────────────────────────

/** Límites de WhatsApp para un mensaje con botones de respuesta. */
export const GATEWAY_MAX_BUTTONS = 3;
export const GATEWAY_MAX_BUTTON_TITLE = 20;
export const GATEWAY_MAX_BUTTON_ID = 256;

export interface GatewayReplyButton {
  /** Vuelve al agente cuando el cliente toca el botón. */
  id: string;
  title: string;
}

/** `POST /gateway/whatsapp/messages`: texto, imagen con pie o texto con botones. */
export interface GatewayWhatsappMessageBody {
  /** Solo para correlación; el destino es `to`. */
  customerId?: string;
  /** E.164. El agente no busca el teléfono por su cuenta. */
  to: string;
  text: string;
  /**
   * Una ruta del propio POS (`/orders/:id/qr-image`), que el agente descarga con
   * su token y sube a WhatsApp, o una URL pública con https. PNG o JPEG. No se
   * combina con `buttons`.
   */
  imageUrl?: string;
  buttons?: GatewayReplyButton[];
}

export interface GatewayMessageResult {
  /** Id del mensaje en WhatsApp o Telegram; el POS lo guarda para reconocer respuestas. */
  externalMessageId: string;
}

/** `POST /gateway/whatsapp/location-requests`: responde `204` sin cuerpo. */
export interface GatewayLocationRequestBody {
  customerId?: string;
  orderId?: string;
  to: string;
  reason?: string;
}

/**
 * Un botón de un aviso al personal. `action` es la ruta del POS que el agente
 * llama (`POST /<action>`) cuando alguien lo toca.
 */
export interface GatewayAlertButton {
  label: string;
  action: string;
}

/** `POST /gateway/telegram/alerts`: aviso al grupo del personal. */
export interface GatewayTelegramAlertBody {
  /** `staff-group` o `delivery-group`. */
  chatRef?: string;
  text: string;
  editMessageId?: string;
  buttons?: GatewayAlertButton[];
}

/**
 * Las acciones que el agente ejecuta cuando alguien toca un botón:
 * `orders/<id>/staff/ready`, `/out` y `/delivered`. Cualquier otra `action` se
 * manda como texto y no se puede tocar.
 */
export const STAFF_ACTION_PATTERN =
  /^orders\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/staff\/(ready|out|delivered)$/i;

/** Cuerpo de `POST /<action>`. */
export interface CentralStaffActionBody {
  /** Quién tocó el botón (su nombre en Telegram). Solo para el registro. */
  actor?: string;
}

/** Lo que devuelve una acción: el aviso tal como queda, para reemplazar el mensaje. */
export interface CentralStaffActionResult {
  text: string;
  /** Los botones que siguen teniendo sentido. Vacío = el pedido se cerró. */
  buttons: GatewayAlertButton[];
}

/** Códigos de error del gateway. */
export const GATEWAY_ERROR = {
  unauthorized: 'unauthorized',
  validation: 'validation_error',
  whatsappSendFailed: 'whatsapp_send_failed',
  telegramSendFailed: 'telegram_send_failed',
} as const;

/**
 * Ids de los botones del desglose en efectivo. Los pone el POS en
 * `buttons[].id` seguidos del número de pedido (`cash_confirm:ORD-000123`), y
 * el agente los reconoce cuando el cliente toca uno.
 */
export const CASH_CONFIRM_BUTTON_PREFIX = 'cash_confirm:';
export const CASH_CANCEL_BUTTON_PREFIX = 'cash_cancel:';
