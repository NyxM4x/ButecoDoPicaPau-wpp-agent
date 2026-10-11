import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Page } from '../components/Layout';
import { PaymentModal } from '../components/Payment';
import { ChannelBadge, PaymentBadge, StatusBadge, Ticket } from '../components/order';
import { Badge, Button, Card, EmptyState, ErrorNote, Modal, PageHeader, Spinner, cx, toast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { DELIVERY_LABEL, dateTime, money, time } from '../lib/format';
import { keys } from '../lib/queries';
import { useSession } from '../lib/session';
import type { LateOrderRequest, Order, OrderStatus } from '../lib/types';

interface Filter {
  id: string;
  label: string;
  query: string;
  keep?: (order: Order) => boolean;
}

const OPEN_STATUSES: OrderStatus[] = ['awaiting_location', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];

const FILTERS: Filter[] = [
  { id: 'open', label: 'En curso', query: '', keep: (order) => OPEN_STATUSES.includes(order.status) },
  { id: 'unpaid', label: 'Sin cobrar', query: '&payment_status=unpaid', keep: (order) => order.status !== 'cancelled' },
  // Delivery en efectivo: el repartidor cobra y liquida después en caja.
  { id: 'riders', label: 'Cuadre con motos', query: '&delivery_type=delivery&payment_status=unpaid', keep: (order) => order.status !== 'cancelled' },
  { id: 'delivered', label: 'Entregados', query: '&status=delivered' },
  { id: 'cancelled', label: 'Cancelados', query: '&status=cancelled' },
  { id: 'all', label: 'Todos', query: '' },
];

export function OrdersPage() {
  const role = useSession((state) => state.user?.role);
  const [filterId, setFilterId] = useState('open');
  const [selected, setSelected] = useState<Order | null>(null);
  const [paying, setPaying] = useState<Order | null>(null);
  const filter = FILTERS.find((item) => item.id === filterId) ?? FILTERS[0]!;

  const orders = useQuery({
    queryKey: keys.orders(filter.id),
    queryFn: async ({ signal }) => {
      const list = await api.get<Order[]>(`/orders?limit=200${filter.query}`, signal);
      return filter.keep ? list.filter(filter.keep) : list;
    },
    refetchInterval: 10_000,
  });

  const canCharge = role === 'admin' || role === 'cashier';

  return (
    <Page>
      <PageHeader title="Pedidos" subtitle="Todos los canales: POS, WhatsApp y web." />
      {canCharge && <LateRequests />}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilterId(item.id)}
            className={cx(
              'rounded-full px-3.5 py-1.5 text-sm font-semibold',
              item.id === filter.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {orders.isPending && (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {orders.isError && <ErrorNote>{errorMessage(orders.error)}</ErrorNote>}
      {orders.data?.length === 0 && <EmptyState title="No hay pedidos en esta vista" />}

      {orders.data && orders.data.length > 0 && (
        <Card className="divide-y divide-slate-100 overflow-hidden">
          {orders.data.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <button type="button" onClick={() => setSelected(order)} className="min-w-0 flex-1 text-left">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-bold tabular-nums">{order.orderNumber}</span>
                  <span className="truncate text-sm text-slate-600">{order.customerName}</span>
                  <span className="text-xs text-slate-400">{time(order.createdAt)}</span>
                </p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  <ChannelBadge channel={order.channel} />
                  <Badge>{DELIVERY_LABEL[order.deliveryType]}</Badge>
                  <StatusBadge status={order.status} />
                  <PaymentBadge order={order} />
                </p>
              </button>
              <span className="text-base font-bold tabular-nums">{money(order.totalAmount)}</span>
              {canCharge && order.paymentStatus !== 'paid' && order.status !== 'cancelled' && (
                <Button size="sm" variant="success" onClick={() => setPaying(order)}>
                  Cobrar
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      {selected && <OrderDetail order={selected} onClose={() => setSelected(null)} onCharge={(order) => (setSelected(null), setPaying(order))} />}
      {paying && <PaymentModal order={paying} onClose={() => setPaying(null)} />}
    </Page>
  );
}

function OrderDetail({ order, onClose, onCharge }: { order: Order; onClose: () => void; onCharge: (order: Order) => void }) {
  const role = useSession((state) => state.user?.role);
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['cash'] });
    onClose();
  };

  const cancelOrder = useMutation({
    mutationFn: () => api.patch<Order>(`/orders/${order.id}/status`, { to: 'cancelled' }),
    onSuccess: () => (toast.ok(`Pedido ${order.orderNumber} cancelado.`), refresh()),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const cancelCash = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/cash/cancel`),
    onSuccess: () => (toast.ok('Se anuló el cobro en efectivo.'), refresh()),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const terminal = order.status === 'delivered' || order.status === 'cancelled';
  const canCharge = role === 'admin' || role === 'cashier';
  // El backend solo deja cambiar el estado a cocina y administración.
  const canCancel = (role === 'admin' || role === 'kitchen') && !terminal;

  return (
    <Modal title={`Pedido ${order.orderNumber}`} onClose={onClose}>
      <div className="space-y-4">
        <Ticket order={order} />
        {order.statusUpdatedBy && <p className="text-center text-xs text-slate-500 print:hidden">Último cambio de estado: {order.statusUpdatedBy}</p>}
        <div className="grid grid-cols-2 gap-2 print:hidden">
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Imprimir
          </Button>
          {canCharge && order.paymentStatus !== 'paid' && order.status !== 'cancelled' && (
            <Button variant="success" onClick={() => onCharge(order)}>
              Cobrar
            </Button>
          )}
          {canCharge && order.paymentStatus === 'paid' && order.paymentMethod === 'cash' && (
            <Button variant="secondary" busy={cancelCash.isPending} onClick={() => cancelCash.mutate()}>
              Anular cobro
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              busy={cancelOrder.isPending}
              onClick={() => {
                if (window.confirm(`¿Cancelar el pedido ${order.orderNumber}? No se puede deshacer.`)) cancelOrder.mutate();
              }}
            >
              Cancelar pedido
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Pedidos de WhatsApp o web que entraron sin caja abierta: quedan en espera
 * hasta que alguien los acepte, y vencen solos a los 10 minutos.
 */
function LateRequests() {
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: keys.lateRequests,
    queryFn: ({ signal }) => api.get<LateOrderRequest[]>('/late-order-requests', signal),
    refetchInterval: 10_000,
  });

  const decide = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => api.post(`/late-order-requests/${id}/${accept ? 'accept' : 'reject'}`, accept ? undefined : {}),
    onSuccess: (_data, { accept }) => toast.ok(accept ? 'Pedido aceptado: ya está en cocina.' : 'Solicitud rechazada.'),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lateRequests });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  if (!requests.data || requests.data.length === 0) return null;

  return (
    <Card className="mb-4 border-l-4 border-amber-500 p-4">
      <h2 className="font-bold">Pedidos esperando aceptación</h2>
      <p className="mb-3 text-sm text-slate-500">Entraron con la caja cerrada. Para aceptarlos hace falta una caja abierta.</p>
      <div className="space-y-2">
        {requests.data.map((request) => (
          <div key={request.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {request.requestNumber} · {request.customerName}
              </p>
              <p className="text-xs text-slate-600">
                Pedido a las {time(request.requestedAt)} · vence {dateTime(request.expiresAt)} · {money(request.subtotalAmount)}
              </p>
            </div>
            <Button size="sm" variant="success" busy={decide.isPending && decide.variables?.id === request.id} onClick={() => decide.mutate({ id: request.id, accept: true })}>
              Aceptar
            </Button>
            <Button size="sm" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ id: request.id, accept: false })}>
              Rechazar
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
