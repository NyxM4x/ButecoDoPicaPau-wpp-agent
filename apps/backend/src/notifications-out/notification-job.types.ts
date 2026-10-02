import {
  TelegramAlertPayload,
  WhatsappLocationRequestPayload,
  WhatsappMessagePayload,
} from '../gateway-client/gateway-client.service';

type WhatsappMessageJobPayload = Omit<WhatsappMessagePayload, 'to'>;
type WhatsappLocationRequestJobPayload = Omit<WhatsappLocationRequestPayload, 'to' | 'orderId'>;

/**
 * `kind` documenta la intención de negocio; `channel` + `payload` es lo que
 * de verdad necesita el gateway para entregar el mensaje. Kinds conocidos:
 * 'order_received' | 'confirmation' | 'location_request' | 'delivery_notice'
 * | 'handoff_notice' | 'late_request_alert' | ...
 */
export type NotificationJobPayload =
  | { channel: 'whatsapp'; kind: string; targetRef: string; payload: WhatsappMessageJobPayload }
  | {
      channel: 'whatsapp';
      kind: 'location_request';
      targetRef: string;
      payload: WhatsappLocationRequestJobPayload;
    }
  | { channel: 'telegram'; kind: string; targetRef: string; payload: TelegramAlertPayload };
