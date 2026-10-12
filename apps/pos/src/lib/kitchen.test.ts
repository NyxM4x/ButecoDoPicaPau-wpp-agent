import { describe, expect, it } from 'vitest';
import { awaitingCustomerConfirm, canStartPreparing, kitchenLines, newArrivals, nextAction, oldestFirst, urgency } from './kitchen';
import type { Order } from './types';

const item = (name: string, quantity: number): Order['items'][number] => ({
  productId: name,
  productCodeSnapshot: name,
  productNameSnapshot: name,
  unitPriceSnapshot: 10,
  quantity,
  subtotal: 10 * quantity,
});

describe('kitchenLines', () => {
  it('desarma los combos en lo que hay que cocinar', () => {
    const lines = kitchenLines({
      items: [item('Papas', 1)],
      promotions: [
        {
          promotionId: 'c1',
          promotionNameSnapshot: 'Combo',
          promoPriceSnapshot: 30,
          comboQuantity: 2,
          subtotal: 60,
          componentsSnapshot: [
            { productId: 'a', code: 'a', name: 'Hamburguesa', unitPrice: 25, quantity: 1 },
            { productId: 'b', code: 'b', name: 'Gaseosa', unitPrice: 8, quantity: 2 },
          ],
        },
      ],
    });
    expect(lines).toEqual([
      { quantity: 1, name: 'Papas' },
      { quantity: 2, name: 'Hamburguesa', combo: 'Combo' },
      { quantity: 4, name: 'Gaseosa', combo: 'Combo' },
    ]);
  });
});

describe('canStartPreparing', () => {
  const pos = { channel: 'pos', cashConfirmedAt: null } as const;

  it('exige pago, salvo delivery en efectivo', () => {
    expect(canStartPreparing({ ...pos, deliveryType: 'pickup', paymentMethod: 'cash', paymentStatus: 'unpaid' })).toBe(false);
    expect(canStartPreparing({ ...pos, deliveryType: 'delivery', paymentMethod: 'qr', paymentStatus: 'unpaid' })).toBe(false);
    expect(canStartPreparing({ ...pos, deliveryType: 'delivery', paymentMethod: 'cash', paymentStatus: 'unpaid' })).toBe(true);
    expect(canStartPreparing({ ...pos, deliveryType: 'dine_in', paymentMethod: 'qr', paymentStatus: 'paid' })).toBe(true);
  });

  it('el efectivo de WhatsApp espera a que el cliente toque CONFIRMAR', () => {
    const whatsapp = { channel: 'whatsapp', deliveryType: 'delivery', paymentMethod: 'cash', paymentStatus: 'unpaid' } as const;
    expect(canStartPreparing({ ...whatsapp, cashConfirmedAt: null })).toBe(false);
    expect(awaitingCustomerConfirm({ ...whatsapp, cashConfirmedAt: null })).toBe(true);
    expect(canStartPreparing({ ...whatsapp, paymentStatus: 'paid', cashConfirmedAt: '2026-10-12T00:10:00Z' })).toBe(true);
    expect(awaitingCustomerConfirm({ ...whatsapp, channel: 'pos', cashConfirmedAt: null })).toBe(false);
  });
});

describe('nextAction', () => {
  it('sigue el flujo del backend', () => {
    expect(nextAction({ status: 'confirmed', deliveryType: 'pickup' })?.to).toBe('preparing');
    expect(nextAction({ status: 'preparing', deliveryType: 'pickup' })?.to).toBe('ready');
    expect(nextAction({ status: 'ready', deliveryType: 'pickup' })?.to).toBe('delivered');
    expect(nextAction({ status: 'ready', deliveryType: 'delivery' })?.to).toBe('out_for_delivery');
    expect(nextAction({ status: 'out_for_delivery', deliveryType: 'delivery' })?.to).toBe('delivered');
  });

  it('no ofrece nada en estados terminales', () => {
    expect(nextAction({ status: 'delivered', deliveryType: 'pickup' })).toBeNull();
    expect(nextAction({ status: 'cancelled', deliveryType: 'pickup' })).toBeNull();
  });
});

describe('oldestFirst', () => {
  it('pone primero el pedido que lleva más tiempo esperando', () => {
    const sorted = oldestFirst([{ createdAt: '2026-10-02T12:10:00Z' }, { createdAt: '2026-10-02T12:00:00Z' }]);
    expect(sorted.map((order) => order.createdAt)).toEqual(['2026-10-02T12:00:00Z', '2026-10-02T12:10:00Z']);
  });
});

describe('newArrivals', () => {
  it('la primera carga no suena', () => {
    expect(newArrivals(null, [{ id: 'a' }])).toEqual([]);
  });

  it('solo devuelve los pedidos que no estaban', () => {
    expect(newArrivals(new Set(['a']), [{ id: 'a' }, { id: 'b' }])).toEqual(['b']);
  });
});

describe('urgency', () => {
  it('marca la espera a los 10 y a los 20 minutos', () => {
    expect(urgency(9)).toBe('normal');
    expect(urgency(10)).toBe('warning');
    expect(urgency(20)).toBe('late');
  });
});
