import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Page } from '../components/Layout';
import { Badge, Button, Card, ErrorNote, Field, Input, PageHeader, Spinner, Textarea, toast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { dateTime, money } from '../lib/format';
import { keys, useCashSession } from '../lib/queries';
import type { CashSession, CurrentCashSession } from '../lib/types';

export function CashRegisterPage() {
  const current = useCashSession();
  const [closed, setClosed] = useState<CashSession | null>(null);

  return (
    <Page className="max-w-4xl">
      <PageHeader title="Caja" subtitle="Una sola caja abierta a la vez para todo el local. Sin caja abierta no se puede cobrar." />

      {current.isPending && (
        <div className="flex justify-center py-16 text-slate-400">
          <Spinner className="h-8 w-8" />
        </div>
      )}
      {current.isError && <ErrorNote>{errorMessage(current.error)}</ErrorNote>}

      {closed && <ClosingReport session={closed} onDismiss={() => setClosed(null)} />}
      {current.data === null && <OpenForm />}
      {current.data && <OpenSession session={current.data} onClosed={setClosed} />}

      <History />
    </Page>
  );
}

function OpenForm() {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');

  const open = useMutation({
    mutationFn: () => api.post<CashSession>('/cash-register/sessions/open', { openingAmount: Number(amount || 0) }),
    onSuccess: () => toast.ok('Caja abierta.'),
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cash'] }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    open.mutate();
  };

  return (
    <Card className="p-5">
      <h2 className="text-lg font-bold">Abrir caja</h2>
      <p className="mb-4 text-sm text-slate-500">Anota el efectivo con el que empieza el turno.</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="Efectivo inicial (Bs)">
            <Input type="number" inputMode="decimal" min={0} step="0.5" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" autoFocus />
          </Field>
        </div>
        <Button type="submit" size="md" busy={open.isPending}>
          Abrir caja
        </Button>
      </form>
    </Card>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-100 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={strong ? 'text-2xl font-bold tabular-nums' : 'text-lg font-semibold tabular-nums'}>{value}</p>
    </div>
  );
}

function OpenSession({ session, onClosed }: { session: CurrentCashSession; onClosed: (session: CashSession) => void }) {
  const queryClient = useQueryClient();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');

  const close = useMutation({
    mutationFn: () =>
      api.post<CashSession>('/cash-register/sessions/close', {
        countedCashAmount: Number(counted),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: (closedSession) => {
      onClosed(closedSession);
      setCounted('');
      setNotes('');
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cash'] }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (window.confirm('¿Cerrar la caja? Los totales quedan congelados y no se pueden cambiar.')) close.mutate();
  };

  // Los totales los calcula el backend: aquí solo se muestran.
  const live = session.liveTotals;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Caja abierta</h2>
          <p className="text-sm text-slate-500">
            Desde {dateTime(session.openedAt)} · abrió {session.openedBy}
          </p>
        </div>
        <Badge tone="green">Abierta</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ventas del turno" value={money(live.totalSalesAmount)} strong />
        <Stat label="En efectivo" value={money(live.totalCashSalesAmount)} />
        <Stat label="Por QR" value={money(live.totalQrSalesAmount)} />
        <Stat label="Efectivo esperado" value={money(live.expectedCashAmount)} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Efectivo esperado = inicial ({money(session.openingAmount)}) + ventas en efectivo. Solo cuentan los pedidos ya pagados.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3 border-t border-slate-200 pt-5">
        <h3 className="font-bold">Cerrar caja</h3>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Efectivo contado (Bs)">
            <Input type="number" inputMode="decimal" min={0} step="0.5" required value={counted} onChange={(event) => setCounted(event.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Notas (opcional)">
            <Textarea rows={1} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Field>
        </div>
        <Button type="submit" variant="danger" busy={close.isPending} disabled={counted === ''}>
          Cerrar caja
        </Button>
      </form>
    </Card>
  );
}

function difference(value: number | null): { text: string; tone: 'green' | 'red' | 'amber' } {
  if (value === null) return { text: '—', tone: 'amber' };
  if (value === 0) return { text: 'Cuadra', tone: 'green' };
  return value < 0 ? { text: `Faltan ${money(-value)}`, tone: 'red' } : { text: `Sobran ${money(value)}`, tone: 'amber' };
}

function ClosingReport({ session, onDismiss }: { session: CashSession; onDismiss: () => void }) {
  const diff = difference(session.cashDifference);
  return (
    <Card className="mb-4 border-l-4 border-emerald-500 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Caja cerrada</h2>
        <Badge tone={diff.tone}>{diff.text}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ventas del turno" value={money(session.totalSalesAmount)} strong />
        <Stat label="En efectivo" value={money(session.totalCashSalesAmount)} />
        <Stat label="Por QR" value={money(session.totalQrSalesAmount)} />
        <Stat label="Esperado / contado" value={`${money(session.expectedCashAmount)} / ${money(session.countedCashAmount)}`} />
      </div>
      <Button variant="secondary" className="mt-4" onClick={onDismiss}>
        Entendido
      </Button>
    </Card>
  );
}

function History() {
  const history = useQuery({
    queryKey: keys.cashHistory,
    queryFn: ({ signal }) => api.get<CashSession[]>('/cash-register/sessions?limit=15', signal),
  });
  const closedSessions = (history.data ?? []).filter((session) => session.status === 'closed');
  if (closedSessions.length === 0) return null;

  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">Cierres anteriores</h2>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Cierre</th>
              <th className="px-4 py-2 font-semibold">Cerró</th>
              <th className="px-4 py-2 text-right font-semibold">Ventas</th>
              <th className="px-4 py-2 text-right font-semibold">Efectivo</th>
              <th className="px-4 py-2 text-right font-semibold">QR</th>
              <th className="px-4 py-2 font-semibold">Arqueo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {closedSessions.map((session) => {
              const diff = difference(session.cashDifference);
              return (
                <tr key={session.id}>
                  <td className="px-4 py-2">{dateTime(session.closedAt)}</td>
                  <td className="px-4 py-2">{session.closedBy ?? '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{money(session.totalSalesAmount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(session.totalCashSalesAmount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(session.totalQrSalesAmount)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={diff.tone}>{diff.text}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
