/**
 * Payload de `notifyPaymentQR` (manual API Market Baneco v1.3.0, sección 7.5
 * + Anexo 1). El manual declara el request como un elemento `Payment` de tipo
 * `PaymentQR` y lo muestra en su ejemplo como `{"payment": {...}}`. Se aceptan
 * las dos formas y también el objeto plano: el qrId es lo único que se usa, y
 * equivocarse acá significa perder la notificación de un pago real.
 */
export interface PaymentQR {
  qrId: string;
  transactionId?: string;
  paymentDate?: string;
  paymentTime?: string;
  currency?: string;
  amount?: number;
  senderBankCode?: string;
  senderName?: string;
  senderDocumentId?: string;
  senderAccount?: string;
}

function readQrId(candidate: unknown): string | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const qrId = (candidate as { qrId?: unknown }).qrId;
  return typeof qrId === 'string' && qrId.trim() !== '' ? qrId.trim() : null;
}

export function extractQrId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const root = body as Record<string, unknown>;
  return readQrId(root.Payment) ?? readQrId(root.payment) ?? readQrId(root);
}
