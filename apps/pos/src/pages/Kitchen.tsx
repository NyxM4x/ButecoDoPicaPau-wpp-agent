import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Clock } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ChannelBadge, OrderLines, PaymentBadge } from '../components/order';
import { Badge, Button, EmptyState, ErrorNote, Spinner, cx, toast } from '../components/ui';
import { api, errorMessage, isApiError } from '../lib/api';
import { enableChime, playChime } from '../lib/chime';
import { DELIVERY_LABEL, elapsed, minutesSince, time } from '../lib/format';
import {
  KITCHEN_STATUSES,
  awaitingCustomerConfirm,
  canStartPreparing,
  newArrivals,
  nextAction,
  oldestFirst,
  urgency,
  type KitchenStatus,
} from '../lib/kitchen';
import { keys } from '../lib/queries';
import { useSession } from '../lib/session';
import type { Order, OrderStatus } from '../lib/types';

const POLL_MS = 5_000;
const FRESH_MS = 30_000;

const COLUMN: Record<KitchenStatus, { title: string; empty: string; accent: string }> = {
  confirmed: { title: 'Nuevos', empty: 'Sin pedidos nuevos', accent: 'border-t-brand-500' },
  preparing: { title: 'En preparación', empty: 'Nada en preparación', accent: 'border-t-sky-500' },
  ready: { title: 'Listos', empty: 'Nada por entregar', accent: 'border-t-emerald-500' },
};

const CLOCK_TONE = { normal: 'text-slate-500', warning: 'text-amber-700', late: 'text-red-700' };

/** Un pedido por estado y no un solo listado: el backend recorta a 200 y ordena del más nuevo al más viejo. */
async function fetchBoard(signal: AbortSignal): Promise<Record<KitchenStatus, Order[]>> {
  const [confirmed, preparing, ready] = await Promise.all(
    KITCHEN_STATUSES.map((status) => api.get<Order[]>(`/orders?status=${status}&limit=200`, signal)),
  );
  return {
    confirmed: oldestFirst(confirmed ?? []),
    preparing: oldestFirst(preparing ?? []),
    ready: oldestFirst(ready ?? []),
  };
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function KitchenPage() {
  const role = useSession((state) => state.user?.role);
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  const [sound, setSound] = useState(false);
  const soundOn = useRef(false);
  const known = useRef<Set<string> | null>(null);
  // id del pedido → hasta cuándo se resalta como recién llegado.
  const [freshUntil, setFreshUntil] = useState<Map<string, number>>(new Map());

  const board = useQuery({
    queryKey: keys.kitchen,
    queryFn: ({ signal }) => fetchBoard(signal),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });

  // Campana y resaltado cuando entra un pedido que no estaba en la consulta anterior.
  useEffect(() => {
    if (!board.data) return;
    const arrivals = newArrivals(known.current, board.data.confirmed);
    known.current = new Set(Object.values(board.data).flatMap((orders) => orders.map((order) => order.id)));
    if (arrivals.length === 0) return;
    if (soundOn.current) playChime();
    const until = Date.now() + FRESH_MS;
    setFreshUntil((current) => new Map([...current, ...arrivals.map((id) => [id, until] as const)]));
  }, [board.data]);

  const move = useMutation({
    mutationFn: ({ id, to }: { id: string; to: OrderStatus }) => api.patch<Order>(`/orders/${id}/status`, { to }),
    onError: (error) => {
      // Dos pantallas de cocina moviendo el mismo pedido es normal: no es un error rojo.
      if (isApiError(error, 'status_conflict')) toast.ok(errorMessage(error));
      else toast.error(errorMessage(error));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.kitchen }),
  });

  const toggleSound = async () => {
    if (sound) {
      soundOn.current = false;
      setSound(false);
      return;
    }
    const enabled = await enableChime();
    soundOn.current = enabled;
    setSound(enabled);
    if (enabled) playChime();
    else toast.error('El navegador no permitió activar el sonido.');
  };

  const canMove = role === 'admin' || role === 'kitchen';
  const total = board.data ? KITCHEN_STATUSES.reduce((sum, status) => sum + board.data[status].length, 0) : 0;

  return (
    <div className="flex h-full flex-col p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Cocina</h1>
          <p className="text-sm text-slate-500">
            {board.isError ? 'Sin conexión: se reintenta solo' : `${total} ${total === 1 ? 'pedido activo' : 'pedidos activos'} · se actualiza cada 5 s`}
          </p>
        </div>
        <Button variant={sound ? 'success' : 'secondary'} onClick={toggleSound}>
          {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          {sound ? 'Sonido activado' : 'Activar sonido'}
        </Button>
      </div>

      {board.isError && !board.data && <ErrorNote>{errorMessage(board.error)}</ErrorNote>}
      {board.isPending && (
        <div className="flex flex-1 items-center justify-center text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      )}

      {board.data && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-3">
          {KITCHEN_STATUSES.map((status) => (
            <section key={status} className={cx('flex min-h-0 flex-col rounded-xl border-t-4 bg-slate-200/60', COLUMN[status].accent)}>
              <header className="flex items-center justify-between px-3 py-2">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">{COLUMN[status].title}</h2>
                <span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-bold tabular-nums text-slate-700">{board.data[status].length}</span>
              </header>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
                {board.data[status].length === 0 && <EmptyState title={COLUMN[status].empty} />}
                {board.data[status].map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    now={now}
                    fresh={(freshUntil.get(order.id) ?? 0) > now}
                    canMove={canMove}
                    busy={move.isPending && move.variables?.id === order.id}
                    onMove={(to) => move.mutate({ id: order.id, to })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface OrderCardProps {
  order: Order;
  now: number;
  fresh: boolean;
  canMove: boolean;
  busy: boolean;
  onMove: (to: OrderStatus) => void;
}

function OrderCard({ order, now, fresh, canMove, busy, onMove }: OrderCardProps) {
  const action = nextAction(order);
  const blocked = order.status === 'confirmed' && !canStartPreparing(order);
  const waiting = urgency(minutesSince(order.createdAt, now));

  return (
    <article className={cx('rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200', fresh && 'ring-2 ring-brand-500')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight tabular-nums">{order.orderNumber}</p>
          <p className="truncate text-sm text-slate-600">{order.customerName}</p>
        </div>
        <div className={cx('flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums', CLOCK_TONE[waiting])} title={`Entró a las ${time(order.createdAt)}`}>
          <Clock className="h-4 w-4" />
          {elapsed(order.createdAt, now)}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <ChannelBadge channel={order.channel} />
        <Badge>{DELIVERY_LABEL[order.deliveryType]}</Badge>
        <PaymentBadge order={order} />
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <OrderLines order={order} large />
      </div>

      {order.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">{order.notes}</p>}

      {action && canMove && (
        <div className="mt-3">
          <Button
            size="lg"
            className="w-full"
            variant={order.status === 'ready' ? 'success' : 'primary'}
            disabled={blocked}
            busy={busy}
            onClick={() => onMove(action.to)}
          >
            {blocked ? (awaitingCustomerConfirm(order) ? 'Esperando que el cliente confirme' : 'Falta cobrar en caja') : action.label}
          </Button>
        </div>
      )}
    </article>
  );
}
