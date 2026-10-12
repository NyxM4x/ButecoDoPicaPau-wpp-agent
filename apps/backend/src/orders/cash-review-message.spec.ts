import { cashConfirmedText, cashReviewButtons, cashReviewText } from './cash-review-message';

describe('cashReviewText', () => {
  it('desglosa productos, envío y total de un delivery', () => {
    const text = cashReviewText({
      orderNumber: 'ORD-000001',
      deliveryType: 'delivery',
      lines: [
        { name: 'Hamburguesa', quantity: 2, subtotal: 36 },
        { name: 'Salchipapa', quantity: 1, subtotal: 18 },
      ],
      deliveryAmount: 18,
      deliveryDistanceMeters: 4079,
      totalAmount: 72,
    });

    expect(text).toContain('Tu pedido ORD-000001 quedó así');
    expect(text).toContain('• 2x Hamburguesa — Bs 36.00');
    expect(text).toContain('• 1x Salchipapa — Bs 18.00');
    expect(text).toContain('Envío: Bs 18.00 (4.1 km)');
    expect(text).toContain('*Total: Bs 72.00*, pagás en efectivo al recibirlo.');
  });

  it('en retiro no menciona envío', () => {
    const text = cashReviewText({
      orderNumber: 'ORD-000002',
      deliveryType: 'pickup',
      lines: [{ name: 'Lomito', quantity: 1, subtotal: 25 }],
      deliveryAmount: 0,
      deliveryDistanceMeters: null,
      totalAmount: 25,
    });

    expect(text).not.toContain('Envío');
    expect(text).toContain('al retirarlo');
  });

  it('recorta las líneas para no pasar el límite de WhatsApp, nunca el total', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({
      name: `Producto con nombre largo número ${i}`,
      quantity: 1,
      subtotal: 10,
    }));
    const text = cashReviewText({
      orderNumber: 'ORD-000003',
      deliveryType: 'delivery',
      lines,
      deliveryAmount: 10,
      deliveryDistanceMeters: 1000,
      totalAmount: 810,
    });

    expect(text.length).toBeLessThanOrEqual(1000);
    expect(text).toMatch(/…y \d+ más/);
    expect(text).toContain('*Total: Bs 810.00*');
  });
});

describe('cashReviewButtons', () => {
  it('lleva el número de pedido en el id, con los prefijos que lee el agente', () => {
    expect(cashReviewButtons('ORD-000001')).toEqual([
      { id: 'cash_confirm:ORD-000001', title: '✅ CONFIRMAR' },
      { id: 'cash_cancel:ORD-000001', title: '❌ CANCELAR' },
    ]);
  });
});

describe('cashConfirmedText', () => {
  it('confirma y recuerda cuánto paga', () => {
    expect(
      cashConfirmedText({ orderNumber: 'ORD-000001', deliveryType: 'delivery', totalAmount: 72 }),
    ).toBe(
      '¡Listo! Tu pedido ORD-000001 está confirmado y ya pasa a cocina 🙌 Pagás Bs 72.00 en efectivo al recibirlo.',
    );
  });
});
