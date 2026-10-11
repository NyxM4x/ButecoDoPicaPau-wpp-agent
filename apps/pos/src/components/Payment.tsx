import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, isApiError } from '../lib/api';
import { PAYMENT_METHOD_LABEL, money } from '../lib/format';
import { useProtectedImage } from '../lib/images';
import type { Order, QrCharge } from '../lib/types';
import { Ticket } from './order';
import { Button, ErrorNote, Field, Input, Modal, Spinner } from './ui';

interface PaymentModalProps {
  order: Order;
  onClose: () => void;
}

/** Cobro de un pedido ya creado y, una vez pagado, su ticket. */
export function PaymentModal({ order: initial, onClose }: PaymentModalProps) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState(initial);
  const [error, setError] = useState<unknown>(null);

  const settle = (updated: Order) => {
    setOrder(updated);
    setError(null);
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['cash'] });
  };

  const paid = order.paymentStatus === 'paid';

  return (
    <Modal title={paid ? `Pedido ${order.orderNumber}` : `Cobrar ${order.orderNumber}`} onClose={onClose}>
      {paid ? (
        <div className="space-y-4">
          <Ticket order={order} />
          <div className="flex gap-2 print:hidden">
            <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button className="flex-1" onClick={onClose}>
              Listo
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-slate-100 px-4 py-3 text-center">
            <p className="text-sm text-slate-500">Total a cobrar · {PAYMENT_METHOD_LABEL[order.paymentMethod]}</p>
            <p className="text-3xl font-bold tabular-nums">{money(order.totalAmount)}</p>
          </div>

          {isApiError(error, 'cash_register_closed') ? (
            <ErrorNote>
              No hay caja abierta.{' '}
              <Link to="/caja" className="font-semibold underline" onClick={onClose}>
                Abrir la caja
              </Link>{' '}
              para poder cobrar. El pedido ya quedó registrado.
            </ErrorNote>
          ) : (
            error !== null && <ErrorNote>{errorMessage(error)}</ErrorNote>
          )}

          {order.paymentMethod === 'cash' ? (
            <CashPayment order={order} onPaid={settle} onError={setError} />
          ) : (
            <QrPayment order={order} onPaid={settle} onError={setError} />
          )}

          <Button variant="ghost" className="w-full" onClick={onClose}>
            Cobrar después
          </Button>
        </div>
      )}
    </Modal>
  );
}

interface MethodProps {
  order: Order;
  onPaid: (order: Order) => void;
  onError: (error: unknown) => void;
}

function CashPayment({ order, onPaid, onError }: MethodProps) {
  const [received, setReceived] = useState('');
  const amount = Number(received);
  const change = received !== '' && Number.isFinite(amount) ? amount - order.totalAmount : null;

  const confirm = useMutation({
    mutationFn: () => api.post<Order>(`/orders/${order.id}/cash/confirm`),
    onSuccess: onPaid,
    onError,
  });

  return (
    <div className="space-y-3">
      <Field label="Recibido (opcional)" hint="Para calcular el vuelto.">
        <Input type="number" inputMode="decimal" min={0} step="0.5" value={received} onChange={(event) => setReceived(event.target.value)} placeholder={order.totalAmount.toFixed(2)} />
      </Field>
      {change !== null && (
        <p className={change < 0 ? 'text-sm font-semibold text-red-700' : 'text-sm font-semibold text-emerald-700'}>
          {change < 0 ? `Faltan ${money(-change)}` : `Vuelto: ${money(change)}`}
        </p>
      )}
      <Button size="lg" variant="success" className="w-full" busy={confirm.isPending} disabled={change !== null && change < 0} onClick={() => confirm.mutate()}>
        Confirmar cobro en efectivo
      </Button>
    </div>
  );
}

function QrPayment({ order, onPaid, onError }: MethodProps) {
  // El QR del banco es idempotente: pedirlo otra vez devuelve el mismo.
  const charge = useQuery({
    queryKey: ['qr', order.id],
    queryFn: () => api.post<QrCharge>(`/orders/${order.id}/qr/generate`),
    retry: false,
    staleTime: Infinity,
  });
  const image = useProtectedImage(charge.data?.qrImageUrl ?? null, order.id);

  // El backend consulta al banco cada ~5 s y marca el pedido como pagado solo.
  const live = useQuery({
    queryKey: ['orders', 'detail', order.id],
    queryFn: ({ signal }) => api.get<Order>(`/orders/${order.id}`, signal),
    refetchInterval: 3_000,
  });
  useEffect(() => {
    if (live.data?.paymentStatus === 'paid') onPaid(live.data);
  }, [live.data, onPaid]);

  useEffect(() => {
    if (charge.error && isApiError(charge.error, 'cash_register_closed')) onError(charge.error);
  }, [charge.error, onError]);

  // No devuelve el pedido sino `{attempt, won}`: hay que volver a pedirlo.
  const manual = useMutation({
    mutationFn: async () => {
      await api.post(`/orders/${order.id}/payment-attempts/confirm-presencial`, { decision: 'accepted' });
      return api.get<Order>(`/orders/${order.id}`);
    },
    onSuccess: onPaid,
    onError,
  });

  return (
    <div className="space-y-3">
      <div className="flex min-h-56 items-center justify-center rounded-xl border border-slate-200 bg-white p-3">
        {charge.isPending && <Spinner className="h-8 w-8 text-slate-400" />}
        {image && <img src={image} alt="Código QR de pago" className="h-56 w-56 object-contain" />}
        {charge.isError && !isApiError(charge.error, 'cash_register_closed') && (
          <p className="px-4 text-center text-sm text-slate-600">
            No se pudo generar el QR del banco. Si el cliente ya pagó por otro medio, confirma el pago manualmente.
          </p>
        )}
      </div>
      {image && <p className="text-center text-sm text-slate-500">Esperando el pago… se confirma solo.</p>}
      <Button size="lg" variant="success" className="w-full" busy={manual.isPending} onClick={() => manual.mutate()}>
        Confirmar pago manualmente
      </Button>
    </div>
  );
}
