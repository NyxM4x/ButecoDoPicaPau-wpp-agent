import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeliveryType, PaymentMethod, Product, Promotion } from './types';

export const MAX_QUANTITY = 10;
export const MAX_PRODUCT_LINES = 20;
export const MAX_PROMOTION_LINES = 10;

export interface CartLine {
  kind: 'product' | 'promotion';
  id: string;
  name: string;
  unitPrice: number;
  quantity: number;
  /** Solo promociones: va en `POST /orders`; si la promo cambió, el backend responde 409. */
  revision?: number;
}

export interface CartState {
  lines: CartLine[];
  /** Se genera al abrir el carrito, no al confirmar: un doble clic no cobra dos veces. */
  idempotencyKey: string | null;
  customerName: string;
  deliveryType: Extract<DeliveryType, 'pickup' | 'dine_in'>;
  paymentMethod: Extract<PaymentMethod, 'cash' | 'qr'>;
  notes: string;
}

interface CartActions {
  addProduct: (product: Product) => void;
  addPromotion: (promotion: Promotion) => void;
  setQuantity: (kind: CartLine['kind'], id: string, quantity: number) => void;
  setField: <K extends 'customerName' | 'deliveryType' | 'paymentMethod' | 'notes'>(key: K, value: CartState[K]) => void;
  clear: () => void;
}

const EMPTY: CartState = {
  lines: [],
  idempotencyKey: null,
  customerName: '',
  deliveryType: 'pickup',
  paymentMethod: 'cash',
  notes: '',
};

/**
 * Agrega una unidad. El backend no admite el mismo producto en dos líneas, así
 * que se consolida; y no admite más de 10 por línea ni más líneas que el tope.
 */
export function addLine(lines: CartLine[], line: Omit<CartLine, 'quantity'>): CartLine[] {
  const index = lines.findIndex((item) => item.kind === line.kind && item.id === line.id);
  if (index >= 0) {
    return lines.map((item, i) =>
      i === index ? { ...item, ...line, quantity: Math.min(item.quantity + 1, MAX_QUANTITY) } : item,
    );
  }
  const limit = line.kind === 'product' ? MAX_PRODUCT_LINES : MAX_PROMOTION_LINES;
  if (lines.filter((item) => item.kind === line.kind).length >= limit) return lines;
  return [...lines, { ...line, quantity: 1 }];
}

export function changeQuantity(lines: CartLine[], kind: CartLine['kind'], id: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((item) => !(item.kind === kind && item.id === id));
  return lines.map((item) =>
    item.kind === kind && item.id === id ? { ...item, quantity: Math.min(Math.trunc(quantity), MAX_QUANTITY) } : item,
  );
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export interface CreateOrderBody {
  channel: 'pos';
  customerName: string;
  deliveryType: CartState['deliveryType'];
  paymentMethod: CartState['paymentMethod'];
  bypassHoursGate: true;
  notes?: string;
  items: { productId: string; quantity: number }[];
  promotions?: { promotionId: string; quantity: number; revision: number }[];
}

/**
 * Cuerpo exacto de `POST /orders`: el backend rechaza con 400 cualquier campo
 * de más, y el orden de los arreglos no debe cambiar entre reintentos.
 */
export function buildOrderBody(cart: CartState): CreateOrderBody {
  const promotions = cart.lines
    .filter((line) => line.kind === 'promotion')
    .map((line) => ({ promotionId: line.id, quantity: line.quantity, revision: line.revision ?? 0 }));
  const notes = cart.notes.trim();
  return {
    channel: 'pos',
    customerName: cart.customerName.trim() || 'Cliente mostrador',
    deliveryType: cart.deliveryType,
    paymentMethod: cart.paymentMethod,
    bypassHoursGate: true,
    ...(notes ? { notes } : {}),
    items: cart.lines
      .filter((line) => line.kind === 'product')
      .map((line) => ({ productId: line.id, quantity: line.quantity })),
    ...(promotions.length > 0 ? { promotions } : {}),
  };
}

function withKey(state: CartState, lines: CartLine[]): Partial<CartState> {
  if (lines.length === 0) return { lines, idempotencyKey: null };
  return { lines, idempotencyKey: state.idempotencyKey ?? crypto.randomUUID() };
}

export const useCart = create<CartState & CartActions>()(
  persist(
    (set) => ({
      ...EMPTY,
      addProduct: (product) =>
        set((state) =>
          withKey(state, addLine(state.lines, { kind: 'product', id: product.id, name: product.name, unitPrice: product.price })),
        ),
      addPromotion: (promotion) =>
        set((state) =>
          withKey(
            state,
            addLine(state.lines, {
              kind: 'promotion',
              id: promotion.id,
              name: promotion.name,
              unitPrice: promotion.promoPrice,
              revision: promotion.revision,
            }),
          ),
        ),
      setQuantity: (kind, id, quantity) => set((state) => withKey(state, changeQuantity(state.lines, kind, id, quantity))),
      setField: (key, value) => set({ [key]: value } as Partial<CartState>),
      clear: () => set({ ...EMPTY }),
    }),
    { name: 'pos-cart' },
  ),
);
