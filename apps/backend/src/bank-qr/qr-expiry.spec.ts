import {
  decideQrExpiry,
  QR_GENERATION_GRACE_MS,
  QR_PAYMENT_WINDOW_MS,
  QrExpiryCharge,
} from './qr-expiry';

describe('decideQrExpiry', () => {
  const now = new Date('2026-10-14T03:30:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const charge = (status: QrExpiryCharge['status'], createdAt: Date): QrExpiryCharge => ({
    status,
    createdAt,
  });

  it('espera mientras el QR sigue dentro de su plazo', () => {
    expect(
      decideQrExpiry({
        now,
        confirmedAt: ago(5 * 60_000),
        charges: [charge('pending', ago(5 * 60_000))],
      }),
    ).toBe('wait');
    expect(
      decideQrExpiry({
        now,
        confirmedAt: ago(QR_PAYMENT_WINDOW_MS),
        charges: [charge('pending', ago(QR_PAYMENT_WINDOW_MS - 1000))],
      }),
    ).toBe('wait');
  });

  it('vence el QR que no se pagó en su plazo', () => {
    expect(
      decideQrExpiry({
        now,
        confirmedAt: ago(QR_PAYMENT_WINDOW_MS),
        charges: [charge('pending', ago(QR_PAYMENT_WINDOW_MS))],
      }),
    ).toBe('expire_unpaid');
  });

  it('el plazo corre desde que se generó el QR, no desde el pedido', () => {
    // El banco tardó: el QR salió 8 minutos después y el cliente tiene su plazo entero.
    expect(
      decideQrExpiry({
        now,
        confirmedAt: ago(QR_PAYMENT_WINDOW_MS + 60_000),
        charges: [charge('pending', ago(QR_PAYMENT_WINDOW_MS - 7 * 60_000))],
      }),
    ).toBe('wait');
  });

  it('sin QR generado espera el margen y después lo da por perdido', () => {
    expect(
      decideQrExpiry({ now, confirmedAt: ago(QR_GENERATION_GRACE_MS - 1000), charges: [] }),
    ).toBe('wait');
    expect(decideQrExpiry({ now, confirmedAt: ago(QR_GENERATION_GRACE_MS), charges: [] })).toBe(
      'expire_never_generated',
    );
  });

  it('un QR que ya venció o se anuló no deja con qué pagar', () => {
    expect(
      decideQrExpiry({
        now,
        confirmedAt: ago(60_000),
        charges: [charge('expired', ago(60_000))],
      }),
    ).toBe('expire_unpaid');
    expect(
      decideQrExpiry({
        now,
        confirmedAt: ago(60_000),
        charges: [charge('cancelled', ago(60_000))],
      }),
    ).toBe('expire_unpaid');
  });

  it('nunca cancela solo un pedido con plata de por medio', () => {
    for (const status of ['confirmed', 'paid_unapplied', 'refunded'] as const) {
      expect(
        decideQrExpiry({
          now,
          confirmedAt: ago(10 * QR_PAYMENT_WINDOW_MS),
          charges: [charge(status, ago(10 * QR_PAYMENT_WINDOW_MS))],
        }),
      ).toBe('hold');
    }
  });

  it('ante una fecha ilegible no cancela', () => {
    expect(decideQrExpiry({ now, confirmedAt: new Date(NaN), charges: [] })).toBe('wait');
    expect(
      decideQrExpiry({
        now,
        confirmedAt: ago(60_000),
        charges: [charge('pending', new Date(NaN))],
      }),
    ).toBe('wait');
  });
});
