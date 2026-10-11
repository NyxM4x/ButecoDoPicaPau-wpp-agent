import { describe, expect, it } from 'vitest';
import { MAX_PRODUCT_LINES, MAX_QUANTITY, addLine, buildOrderBody, cartCount, cartTotal, changeQuantity, type CartLine, type CartState } from './cart';

const burger = { kind: 'product' as const, id: 'p1', name: 'Hamburguesa', unitPrice: 25 };
const soda = { kind: 'product' as const, id: 'p2', name: 'Gaseosa', unitPrice: 8 };
const combo = { kind: 'promotion' as const, id: 'c1', name: 'Combo', unitPrice: 30, revision: 4 };

function cart(lines: CartLine[], extra: Partial<CartState> = {}): CartState {
  return { lines, idempotencyKey: 'k', customerName: '', deliveryType: 'pickup', paymentMethod: 'cash', notes: '', ...extra };
}

describe('addLine', () => {
  it('consolida el mismo producto en una sola línea', () => {
    const lines = addLine(addLine([], burger), burger);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(2);
  });

  it('no pasa de 10 unidades por línea', () => {
    let lines: CartLine[] = [];
    for (let i = 0; i < 15; i += 1) lines = addLine(lines, burger);
    expect(lines[0]?.quantity).toBe(MAX_QUANTITY);
  });

  it('un producto y una promoción con el mismo id son líneas distintas', () => {
    const lines = addLine(addLine([], burger), { ...combo, id: 'p1' });
    expect(lines).toHaveLength(2);
  });

  it('no agrega más líneas de producto que el tope del backend', () => {
    let lines: CartLine[] = [];
    for (let i = 0; i < MAX_PRODUCT_LINES + 5; i += 1) lines = addLine(lines, { ...burger, id: `p${i}` });
    expect(lines).toHaveLength(MAX_PRODUCT_LINES);
  });

  it('toma la revisión más reciente de la promoción', () => {
    const lines = addLine(addLine([], combo), { ...combo, revision: 5 });
    expect(lines[0]).toMatchObject({ quantity: 2, revision: 5 });
  });
});

describe('changeQuantity', () => {
  it('quita la línea al llegar a cero', () => {
    expect(changeQuantity(addLine([], burger), 'product', 'p1', 0)).toEqual([]);
  });

  it('recorta al máximo', () => {
    expect(changeQuantity(addLine([], burger), 'product', 'p1', 99)[0]?.quantity).toBe(MAX_QUANTITY);
  });
});

describe('totales', () => {
  it('suma precio por cantidad', () => {
    const lines = addLine(addLine(addLine([], burger), burger), soda);
    expect(cartTotal(lines)).toBe(58);
    expect(cartCount(lines)).toBe(3);
  });
});

describe('buildOrderBody', () => {
  it('manda exactamente los campos del contrato', () => {
    const body = buildOrderBody(cart(addLine(addLine([], burger), combo), { customerName: '  Ana ', notes: ' sin cebolla ' }));
    expect(body).toEqual({
      channel: 'pos',
      customerName: 'Ana',
      deliveryType: 'pickup',
      paymentMethod: 'cash',
      bypassHoursGate: true,
      notes: 'sin cebolla',
      items: [{ productId: 'p1', quantity: 1 }],
      promotions: [{ promotionId: 'c1', quantity: 1, revision: 4 }],
    });
  });

  it('usa «Cliente mostrador» y omite lo vacío', () => {
    const body = buildOrderBody(cart(addLine([], burger)));
    expect(body.customerName).toBe('Cliente mostrador');
    expect(body).not.toHaveProperty('notes');
    expect(body).not.toHaveProperty('promotions');
  });

  it('un pedido solo de promociones lleva items vacío', () => {
    expect(buildOrderBody(cart(addLine([], combo))).items).toEqual([]);
  });

  it('serializa igual dos veces: el reintento idempotente reusa el mismo cuerpo', () => {
    const state = cart(addLine(addLine([], soda), burger));
    expect(JSON.stringify(buildOrderBody(state))).toBe(JSON.stringify(buildOrderBody(state)));
  });
});
