import type { Order, OrderStatus } from './types';

/** Estados que ve la cocina, en el orden de las columnas del tablero. */
export const KITCHEN_STATUSES = ['confirmed', 'preparing', 'ready'] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export interface KitchenLine {
  quantity: number;
  name: string;
  /** Nombre del combo del que sale la línea, si viene de una promoción. */
  combo?: string;
}

/**
 * Lo que hay que cocinar. `items` trae solo los productos sueltos: los combos
 * vienen aparte en `promotions`, y sin desarmarlos el ticket de cocina queda
 * incompleto.
 */
export function kitchenLines(order: Pick<Order, 'items' | 'promotions'>): KitchenLine[] {
  const lines: KitchenLine[] = order.items.map((item) => ({ quantity: item.quantity, name: item.productNameSnapshot }));
  for (const promotion of order.promotions) {
    for (const component of promotion.componentsSnapshot) {
      lines.push({
        quantity: component.quantity * promotion.comboQuantity,
        name: component.name,
        combo: promotion.promotionNameSnapshot,
      });
    }
  }
  return lines;
}

/** El delivery en efectivo se cobra al entregar: es el único que entra a cocina sin estar pagado. */
export function isCashOnDelivery(order: Pick<Order, 'deliveryType' | 'paymentMethod'>): boolean {
  return order.deliveryType === 'delivery' && order.paymentMethod === 'cash';
}

/**
 * Pedido en efectivo de WhatsApp o web que el cliente todavía no confirmó.
 *
 * Recibe el desglose con el envío y los botones CONFIRMAR / CANCELAR; hasta que
 * toca CONFIRMAR puede echarse atrás por el precio, así que no se cocina. Las
 * ventas del POS no pasan por ese paso.
 */
export function awaitingCustomerConfirm(
  order: Pick<Order, 'channel' | 'paymentMethod' | 'paymentStatus' | 'cashConfirmedAt'>,
): boolean {
  return order.channel !== 'pos' && order.paymentMethod === 'cash' && order.paymentStatus !== 'paid' && order.cashConfirmedAt === null;
}

export function canStartPreparing(
  order: Pick<Order, 'channel' | 'deliveryType' | 'paymentMethod' | 'paymentStatus' | 'cashConfirmedAt'>,
): boolean {
  if (awaitingCustomerConfirm(order)) return false;
  return order.paymentStatus === 'paid' || isCashOnDelivery(order);
}

export interface KitchenAction {
  to: OrderStatus;
  label: string;
}

/** Siguiente paso del pedido en cocina. Las transiciones las valida el backend; esto solo arma el botón. */
export function nextAction(order: Pick<Order, 'status' | 'deliveryType'>): KitchenAction | null {
  switch (order.status) {
    case 'confirmed':
      return { to: 'preparing', label: 'Iniciar' };
    case 'preparing':
      return { to: 'ready', label: 'Listo' };
    case 'ready':
      return order.deliveryType === 'delivery'
        ? { to: 'out_for_delivery', label: 'Salió a reparto' }
        : { to: 'delivered', label: 'Entregado' };
    case 'out_for_delivery':
      return { to: 'delivered', label: 'Entregado' };
    default:
      return null;
  }
}

/** La cocina atiende primero lo más viejo; el backend lista al revés. */
export function oldestFirst<T extends Pick<Order, 'createdAt'>>(orders: T[]): T[] {
  return [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * Pedidos que entraron desde la última consulta, para hacer sonar la campana.
 * La primera carga (`known === null`) no suena: son pedidos que ya estaban.
 */
export function newArrivals(known: ReadonlySet<string> | null, current: Pick<Order, 'id'>[]): string[] {
  if (known === null) return [];
  return current.filter((order) => !known.has(order.id)).map((order) => order.id);
}

export type Urgency = 'normal' | 'warning' | 'late';

/** Color del reloj de la tarjeta según cuánto lleva esperando el pedido. */
export function urgency(minutes: number): Urgency {
  if (minutes >= 20) return 'late';
  if (minutes >= 10) return 'warning';
  return 'normal';
}
