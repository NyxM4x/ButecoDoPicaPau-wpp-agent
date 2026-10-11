import type { DeliveryType, OrderChannel, OrderStatus, PaymentMethod, PaymentStatus, PromotionStatus, Role } from './types';

/** El backend entrega los precios como número: aquí se les pone moneda y dos decimales. */
export function money(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return `Bs ${amount.toFixed(2)}`;
}

const TIME = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hour12: false });
const DATE_TIME = new Intl.DateTimeFormat('es-BO', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function time(iso: string): string {
  return TIME.format(new Date(iso));
}

export function dateTime(iso: string | null): string {
  return iso ? DATE_TIME.format(new Date(iso)) : '—';
}

export function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export function elapsed(iso: string, now: number): string {
  const minutes = minutesSince(iso, now);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export const CHANNEL_LABEL: Record<OrderChannel, string> = {
  whatsapp: 'WhatsApp',
  web: 'Web',
  pos: 'POS',
};

export const DELIVERY_LABEL: Record<DeliveryType, string> = {
  pickup: 'Para llevar',
  dine_in: 'Mesa',
  delivery: 'Delivery',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  qr: 'QR',
  card: 'Tarjeta',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: 'Sin pagar',
  pending_review: 'Pago en revisión',
  paid: 'Pagado',
  rejected: 'Pago rechazado',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Borrador',
  awaiting_location: 'Esperando ubicación',
  confirmed: 'Nuevo',
  preparing: 'En preparación',
  ready: 'Listo',
  out_for_delivery: 'En reparto',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export const PROMOTION_STATUS_LABEL: Record<PromotionStatus, string> = {
  activa: 'Activa',
  agotada: 'Agotada',
  sin_ahorro: 'Sin ahorro',
  inactiva: 'Inactiva',
  archivada: 'Archivada',
  programada: 'Programada',
  expirada: 'Expirada',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  kitchen: 'Cocina',
  cashier: 'Caja',
};

/** Nombre de respaldo: el real viene de la configuración del backend (ver restaurant.ts). */
export const RESTAURANT_NAME: string = import.meta.env.VITE_RESTAURANT_NAME || 'Restaurante';
