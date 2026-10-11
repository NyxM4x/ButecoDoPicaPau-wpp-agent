import { MessageCircle, Monitor, Globe } from 'lucide-react';
import {
  CHANNEL_LABEL,
  DELIVERY_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  dateTime,
  money,
} from '../lib/format';
import { isCashOnDelivery, kitchenLines } from '../lib/kitchen';
import { useRestaurantName } from '../lib/restaurant';
import type { Order, OrderChannel, OrderStatus } from '../lib/types';
import { Badge, type Tone } from './ui';

const CHANNEL_ICON: Record<OrderChannel, typeof Monitor> = { whatsapp: MessageCircle, pos: Monitor, web: Globe };
const CHANNEL_TONE: Record<OrderChannel, Tone> = { whatsapp: 'green', pos: 'blue', web: 'neutral' };

export function ChannelBadge({ channel }: { channel: OrderChannel }) {
  const Icon = CHANNEL_ICON[channel];
  return (
    <Badge tone={CHANNEL_TONE[channel]} className="uppercase tracking-wide">
      <Icon className="h-3.5 w-3.5" />
      {CHANNEL_LABEL[channel]}
    </Badge>
  );
}

const STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: 'neutral',
  awaiting_location: 'amber',
  confirmed: 'orange',
  preparing: 'blue',
  ready: 'green',
  out_for_delivery: 'blue',
  delivered: 'neutral',
  cancelled: 'red',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

/**
 * `status` y `paymentStatus` son independientes en el backend. Sin pagar es
 * normal en un delivery en efectivo (se cobra al entregar), así que ahí no se
 * marca en rojo.
 */
export function PaymentBadge({ order }: { order: Pick<Order, 'paymentStatus' | 'paymentMethod' | 'deliveryType'> }) {
  const method = PAYMENT_METHOD_LABEL[order.paymentMethod];
  if (order.paymentStatus === 'paid') return <Badge tone="green">Pagado · {method}</Badge>;
  if (order.paymentStatus === 'unpaid' && isCashOnDelivery(order)) return <Badge tone="amber">Cobra el repartidor</Badge>;
  const tone: Tone = order.paymentStatus === 'pending_review' ? 'amber' : 'red';
  return (
    <Badge tone={tone}>
      {PAYMENT_STATUS_LABEL[order.paymentStatus]} · {method}
    </Badge>
  );
}

export function OrderLines({ order, large = false }: { order: Pick<Order, 'items' | 'promotions'>; large?: boolean }) {
  return (
    <ul className={large ? 'space-y-1 text-base' : 'space-y-0.5 text-sm'}>
      {kitchenLines(order).map((line, index) => (
        <li key={index} className="flex gap-2">
          <span className="w-7 shrink-0 text-right font-bold tabular-nums">{line.quantity}×</span>
          <span className="min-w-0">
            <span className="font-medium">{line.name}</span>
            {line.combo && <span className="ml-1.5 text-xs text-slate-500">({line.combo})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Ticket para imprimir. Los importes son los del backend: nunca se recalculan aquí. */
export function Ticket({ order }: { order: Order }) {
  const restaurantName = useRestaurantName();
  const delivery = order.deliveryBaseAmount + order.deliverySurchargeAmount;
  return (
    <div className="ticket mx-auto w-full max-w-xs rounded-lg border border-slate-200 bg-white p-4 font-mono text-[13px] leading-snug text-slate-900">
      <p className="text-center text-base font-bold">{restaurantName}</p>
      <p className="text-center">{order.orderNumber}</p>
      <p className="text-center text-xs">{dateTime(order.createdAt)}</p>
      <hr className="my-2 border-dashed border-slate-400" />
      <p>Cliente: {order.customerName}</p>
      <p>
        {DELIVERY_LABEL[order.deliveryType]} · {CHANNEL_LABEL[order.channel]}
      </p>
      <hr className="my-2 border-dashed border-slate-400" />
      {order.items.map((item) => (
        <div key={item.productId} className="flex justify-between gap-2">
          <span>
            {item.quantity}× {item.productNameSnapshot}
          </span>
          <span className="tabular-nums">{item.subtotal.toFixed(2)}</span>
        </div>
      ))}
      {order.promotions.map((promotion, index) => (
        <div key={index}>
          <div className="flex justify-between gap-2">
            <span>
              {promotion.comboQuantity}× {promotion.promotionNameSnapshot}
            </span>
            <span className="tabular-nums">{promotion.subtotal.toFixed(2)}</span>
          </div>
          {promotion.componentsSnapshot.map((component) => (
            <p key={component.productId} className="pl-4 text-xs">
              {component.quantity * promotion.comboQuantity}× {component.name}
            </p>
          ))}
        </div>
      ))}
      {order.notes && <p className="mt-2 whitespace-pre-wrap">Nota: {order.notes}</p>}
      <hr className="my-2 border-dashed border-slate-400" />
      {delivery > 0 && (
        <>
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{order.subtotalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Envío</span>
            <span className="tabular-nums">{delivery.toFixed(2)}</span>
          </div>
        </>
      )}
      <div className="flex justify-between text-base font-bold">
        <span>TOTAL</span>
        <span className="tabular-nums">{money(order.totalAmount)}</span>
      </div>
      <p className="mt-1">
        {PAYMENT_METHOD_LABEL[order.paymentMethod]} · {PAYMENT_STATUS_LABEL[order.paymentStatus]}
      </p>
      <p className="mt-3 text-center text-xs">¡Gracias por su compra!</p>
    </div>
  );
}
