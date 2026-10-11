// Formas de respuesta del backend central. Se escriben a mano porque en el
// backend son `interface` y no salen en el OpenAPI (ver
// apps/backend/docs/pos-frontend-handoff.md).

export type Role = 'admin' | 'kitchen' | 'cashier';
export type OrderChannel = 'whatsapp' | 'web' | 'pos';
export type DeliveryType = 'delivery' | 'pickup' | 'dine_in';
export type PaymentMethod = 'qr' | 'cash' | 'card';
export type PaymentStatus = 'unpaid' | 'pending_review' | 'paid' | 'rejected';
export type OrderStatus =
  | 'draft'
  | 'awaiting_location'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

export interface StaffUser {
  id: string;
  username: string;
  role: Role;
}

export interface LoginResponse {
  accessToken: string;
  user: StaffUser;
}

export interface StaffUserRow extends StaffUser {
  isActive: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  categoryId: string;
  price: number;
  isActive: boolean;
  isAvailable: boolean;
  sortOrder: number;
  /** Ruta relativa al backend (`/products/:id/image`) o null. */
  imageUrl: string | null;
}

export type PromotionStatus =
  | 'activa'
  | 'agotada'
  | 'sin_ahorro'
  | 'inactiva'
  | 'archivada'
  | 'programada'
  | 'expirada';

export interface PromotionItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

export interface Promotion {
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
  revision: number;
  status: PromotionStatus;
  items: PromotionItem[];
}

export interface OrderItem {
  productId: string;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  unitPriceSnapshot: number;
  quantity: number;
  subtotal: number;
}

export interface OrderPromotionComponent {
  productId: string;
  code: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderPromotion {
  promotionId: string | null;
  promotionNameSnapshot: string;
  promoPriceSnapshot: number;
  comboQuantity: number;
  subtotal: number;
  componentsSnapshot: OrderPromotionComponent[];
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  channel: OrderChannel;
  customerName: string;
  deliveryType: DeliveryType;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
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
  items: OrderItem[];
  promotions: OrderPromotion[];
}

export interface OperationalSettings {
  rainSurchargeEnabled: boolean;
  rainSurchargeAmount: number;
  businessOpensHour: number;
  businessClosesHour: number;
  restaurantLatitude: number | null;
  restaurantLongitude: number | null;
  ordersPaused: boolean;
  pickupEnabled: boolean;
  restaurantName: string;
}

export interface CashSession {
  id: string;
  status: 'open' | 'closed';
  openedAt: string;
  openedBy: string;
  openingAmount: number;
  closedAt: string | null;
  closedBy: string | null;
  countedCashAmount: number | null;
  expectedCashAmount: number | null;
  cashDifference: number | null;
  totalCashSalesAmount: number | null;
  totalQrSalesAmount: number | null;
  totalSalesAmount: number | null;
  notes: string | null;
}

export interface CashLiveTotals {
  totalCashSalesAmount: number;
  totalQrSalesAmount: number;
  totalSalesAmount: number;
  expectedCashAmount: number;
}

export type CurrentCashSession = CashSession & { liveTotals: CashLiveTotals };

export interface LateOrderRequest {
  id: string;
  requestNumber: string;
  customerId: string | null;
  customerName: string;
  status: string;
  subtotalAmount: number;
  requestedAt: string;
  expiresAt: string;
  orderId: string | null;
}

export interface QrCharge {
  orderId: string;
  status: string;
  qrImageUrl: string;
  dueDate: string;
}
