import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { NotificationsOutService } from '../notifications-out/notifications-out.service';
import { QrCheckoutService } from './qr-checkout.service';
import { QrPaymentsService } from './qr-payments.service';

type JobStatus = 'pending' | 'sending' | 'sent' | 'failed';

interface DbInput {
  deliveryQuoteStatus?: 'pending' | 'quoted';
  /** Modo «sin POS» = `false`. Ausente = con POS, como venía. */
  requiresCashRegister?: boolean;
  /** Avisos ya en la cola, por tipo y pedido. */
  jobs?: Array<{ kind: string; targetRef: string; status: JobStatus }>;
  /** Pedidos que devuelve la búsqueda del reintento. */
  retryCandidates?: string[];
}

function makeDb(input: DbInput = {}) {
  const deliveryQuoteStatus = input.deliveryQuoteStatus ?? 'quoted';
  const order = {
    id: 'order-1',
    order_number: 'ORD-000001',
    customer_id: 'customer-1',
    delivery_type: 'delivery',
    delivery_quote_status: deliveryQuoteStatus,
    payment_method: 'qr',
    payment_status: 'unpaid',
    total_amount: deliveryQuoteStatus === 'quoted' ? '62.00' : '50.00',
  };
  const jobs = input.jobs ?? [];

  const selectFrom = jest.fn((table: string) => {
    const filters = new Map<string, unknown>();
    const builder = {
      select: () => builder,
      where: (column: string, _operator: string, value: unknown) => {
        filters.set(column, value);
        return builder;
      },
      orderBy: () => builder,
      limit: () => builder,
      executeTakeFirst: async () => {
        if (table === 'orders') return order;
        if (table === 'operational_settings') {
          return {
            currency_symbol: 'Bs',
            requires_cash_register: input.requiresCashRegister ?? true,
          };
        }
        return jobs.find(
          (job) => job.kind === filters.get('kind') && job.targetRef === filters.get('target_ref'),
        );
      },
      execute: async () => {
        if (table === 'orders') return (input.retryCandidates ?? []).map((id) => ({ id }));
        const targets = filters.get('target_ref') as string[];
        return jobs
          .filter((job) => job.kind === filters.get('kind') && targets.includes(job.targetRef))
          .map((job) => ({ target_ref: job.targetRef }));
      },
    };
    return builder;
  });

  return { selectFrom } as unknown as Kysely<Database>;
}

function makeService(db: Kysely<Database>) {
  const generateForOrder = jest.fn().mockResolvedValue({
    orderId: 'order-1',
    status: 'pending',
    qrImageUrl: '/orders/order-1/qr-image',
    dueDate: '2026-09-19',
  });
  const notifyNow = jest.fn().mockResolvedValue(undefined);

  const service = new QrCheckoutService(
    db,
    { generateForOrder } as unknown as QrPaymentsService,
    { notifyNow } as unknown as NotificationsOutService,
  );
  return { service, generateForOrder, notifyNow };
}

describe('QrCheckoutService', () => {
  it('does not generate a QR while delivery total is still pending', async () => {
    const { service, generateForOrder, notifyNow } = makeService(
      makeDb({ deliveryQuoteStatus: 'pending' }),
    );

    await expect(service.notifyIfReady('order-1')).resolves.toBe('skipped');
    expect(generateForOrder).not.toHaveBeenCalled();
    expect(notifyNow).not.toHaveBeenCalled();
  });

  it('generates and notifies only after the delivery quote is final', async () => {
    const { service, generateForOrder, notifyNow } = makeService(makeDb());

    await expect(service.notifyIfReady('order-1')).resolves.toBe('notified');
    expect(generateForOrder).toHaveBeenCalledWith('order-1');
    expect(notifyNow).toHaveBeenCalledWith({
      channel: 'whatsapp',
      kind: 'qr_confirmation',
      targetRef: 'order-1',
      payload: {
        customerId: 'customer-1',
        text: 'Tu pedido ORD-000001 es Bs 62.00. Escaneá el QR para pagar.',
        // La ruta protegida de este backend: el agente la descarga con su token.
        imageUrl: '/orders/order-1/qr-image',
      },
    });
  });

  it('does not resend an already queued or sent QR notification', async () => {
    const { service, generateForOrder, notifyNow } = makeService(
      makeDb({ jobs: [{ kind: 'qr_confirmation', targetRef: 'order-1', status: 'sent' }] }),
    );

    await expect(service.notifyIfReady('order-1')).resolves.toBe('skipped');
    expect(generateForOrder).not.toHaveBeenCalled();
    expect(notifyNow).not.toHaveBeenCalled();
  });

  describe('con POS', () => {
    it('si el banco falla, pide la captura como antes', async () => {
      const { service, generateForOrder, notifyNow } = makeService(makeDb());
      generateForOrder.mockRejectedValue(new Error('banco caído'));

      await expect(service.notifyIfReady('order-1')).resolves.toBe('notified');
      expect(notifyNow).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'qr_confirmation',
          payload: {
            customerId: 'customer-1',
            text: 'Tu pedido ORD-000001 es Bs 62.00. Cuando pagues, responde a este mensaje con la captura.',
          },
        }),
      );
    });

    it('no reintenta nada: eso lo resuelve el cajero', async () => {
      const { service, generateForOrder } = makeService(makeDb({ retryCandidates: ['order-1'] }));

      await expect(service.retryUndelivered()).resolves.toEqual({ retried: 0, delivered: 0 });
      expect(generateForOrder).not.toHaveBeenCalled();
    });
  });

  describe('modo sin POS', () => {
    it('avisa cuánto tiempo hay para pagar', async () => {
      const { service, notifyNow } = makeService(makeDb({ requiresCashRegister: false }));

      await expect(service.notifyIfReady('order-1')).resolves.toBe('notified');
      expect(notifyNow.mock.calls[0][0].payload.text).toBe(
        'Tu pedido ORD-000001 es Bs 62.00. Escaneá el QR para pagar. El QR vence en 30 minutos.',
      );
    });

    it('si el banco falla no pide una captura que nadie puede revisar: avisa que tarda', async () => {
      const { service, generateForOrder, notifyNow } = makeService(
        makeDb({ requiresCashRegister: false }),
      );
      generateForOrder.mockRejectedValue(new Error('banco caído'));

      await expect(service.notifyIfReady('order-1')).resolves.toBe('deferred');
      expect(notifyNow).toHaveBeenCalledTimes(1);
      expect(notifyNow).toHaveBeenCalledWith({
        channel: 'whatsapp',
        kind: 'qr_delayed_notice',
        targetRef: 'order-1',
        payload: {
          customerId: 'customer-1',
          text: 'Tu pedido ORD-000001 es Bs 62.00. Estamos generando tu QR de pago: te lo enviamos en unos minutos.',
        },
      });
    });

    it('el aviso de demora sale una sola vez aunque el QR se reintente', async () => {
      const { service, generateForOrder, notifyNow } = makeService(
        makeDb({
          requiresCashRegister: false,
          jobs: [{ kind: 'qr_delayed_notice', targetRef: 'order-1', status: 'sent' }],
        }),
      );
      generateForOrder.mockRejectedValue(new Error('banco caído'));

      await expect(service.notifyIfReady('order-1')).resolves.toBe('deferred');
      expect(notifyNow).not.toHaveBeenCalled();
    });

    it('reintenta los pedidos que todavía no tienen su QR en la cola', async () => {
      const { service, generateForOrder, notifyNow } = makeService(
        makeDb({ requiresCashRegister: false, retryCandidates: ['order-1'] }),
      );

      await expect(service.retryUndelivered()).resolves.toEqual({ retried: 1, delivered: 1 });
      expect(generateForOrder).toHaveBeenCalledWith('order-1');
      expect(notifyNow).toHaveBeenCalledWith(expect.objectContaining({ kind: 'qr_confirmation' }));
    });

    it('no reintenta un QR cuyo envío ya está en la cola, aunque esté fallando', async () => {
      const { service, generateForOrder } = makeService(
        makeDb({
          requiresCashRegister: false,
          retryCandidates: ['order-1'],
          jobs: [{ kind: 'qr_confirmation', targetRef: 'order-1', status: 'failed' }],
        }),
      );

      await expect(service.retryUndelivered()).resolves.toEqual({ retried: 0, delivered: 0 });
      expect(generateForOrder).not.toHaveBeenCalled();
    });
  });
});
