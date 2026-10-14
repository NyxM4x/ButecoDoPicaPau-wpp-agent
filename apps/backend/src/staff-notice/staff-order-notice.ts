/**
 * El pedido completo, tal como lo recibe el personal por Telegram.
 *
 * En modo «sin POS» no hay pantalla de cocina ni de caja: este mensaje ES la
 * comanda. Por eso lleva todo lo que hace falta para preparar, entregar y
 * cobrar sin abrir nada más: qué pidió, quién, dónde se lo llevan, cuánto es y
 * si ya está pagado o hay que cobrarlo.
 *
 * Módulo puro: recibe datos y devuelve texto.
 */

/** Telegram corta los mensajes a 4096 caracteres; se deja margen. */
const BODY_MAX = 3500;

export interface StaffNoticeLine {
  name: string;
  quantity: number;
  subtotal: number;
  /** Lo que trae dentro un combo, para que cocina no tenga que saberlo de memoria. */
  components?: { name: string; quantity: number }[];
}

export interface StaffOrderNoticeInput {
  orderNumber: string;
  deliveryType: string;
  paymentMethod: string;
  /** ¿El dinero ya entró (QR o comprobante aceptado)? */
  paid: boolean;
  customerName: string;
  customerPhone: string | null;
  lines: StaffNoticeLine[];
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  deliveryDistanceMeters: number | null;
  subtotalAmount: number;
  deliveryAmount: number;
  totalAmount: number;
  currencySymbol: string;
}

const DELIVERY_LABEL: Record<string, string> = {
  delivery: 'ENVÍO A DOMICILIO',
  pickup: 'RETIRA EN EL LOCAL',
  dine_in: 'EN EL LOCAL',
};

const PAYMENT_LABEL: Record<string, string> = { cash: 'EFECTIVO', qr: 'QR', card: 'TARJETA' };

function money(amount: number, symbol: string): string {
  return `${symbol} ${amount.toFixed(2)}`;
}

/** Enlace que abre el punto en Google Maps desde cualquier teléfono. */
export function mapsLink(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

/** Qué hay que hacer con el dinero: es lo último que lee quien entrega. */
function collectLine(input: StaffOrderNoticeInput): string {
  const total = money(input.totalAmount, input.currencySymbol);
  if (input.paid) return `TOTAL: ${total} — YA PAGADO, no cobrar`;
  const when = input.deliveryType === 'delivery' ? 'al entregar' : 'al retirar';
  return `TOTAL: ${total} — COBRAR ${when}`;
}

export function staffOrderNoticeText(input: StaffOrderNoticeInput): string {
  const symbol = input.currencySymbol;
  const isDelivery = input.deliveryType === 'delivery';

  const head = [
    `🆕 PEDIDO ${input.orderNumber}`,
    `${DELIVERY_LABEL[input.deliveryType] ?? input.deliveryType.toUpperCase()} · ${
      PAYMENT_LABEL[input.paymentMethod] ?? input.paymentMethod.toUpperCase()
    }${input.paid ? ' (pagado)' : ''}`,
    `👤 ${input.customerName}${input.customerPhone ? ` — ${input.customerPhone}` : ''}`,
    '',
  ];

  const tail: string[] = [];
  if (input.notes?.trim()) tail.push(`📝 ${input.notes.trim()}`);
  tail.push('');
  if (isDelivery) {
    if (input.latitude !== null && input.longitude !== null) {
      const km =
        input.deliveryDistanceMeters !== null && input.deliveryDistanceMeters > 0
          ? ` (${(input.deliveryDistanceMeters / 1000).toFixed(1)} km)`
          : '';
      tail.push(`📍 ${mapsLink(input.latitude, input.longitude)}${km}`);
    } else {
      tail.push('📍 Sin ubicación: pedírsela al cliente.');
    }
    tail.push(`Productos: ${money(input.subtotalAmount, symbol)}`);
    tail.push(`Envío: ${money(input.deliveryAmount, symbol)}`);
  }
  tail.push(collectLine(input));

  const lines = input.lines.flatMap((line) => [
    `• ${line.quantity}x ${line.name} — ${money(line.subtotal, symbol)}`,
    ...(line.components ?? []).map((c) => `     ${c.quantity * line.quantity}x ${c.name}`),
  ]);

  // Un pedido enorme no puede comerse el total ni la dirección: se recortan
  // las líneas, nunca lo de abajo.
  const fixedLength = [...head, ...tail].join('\n').length + 1;
  const kept: string[] = [];
  let used = fixedLength;
  for (const [index, line] of lines.entries()) {
    if (used + line.length + 1 + 30 > BODY_MAX) {
      kept.push(`…y ${lines.length - index} líneas más: ver el pedido completo en el sistema.`);
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }

  return [...head, ...kept, ...tail].join('\n');
}
