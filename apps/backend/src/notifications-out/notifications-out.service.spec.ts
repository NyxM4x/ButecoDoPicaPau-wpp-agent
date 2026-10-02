import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { GatewayClientService } from '../gateway-client/gateway-client.service';
import { NotificationsOutService } from './notifications-out.service';

type SendOnly = {
  send(
    channel: string,
    kind: string,
    targetRef: string,
    payload: Record<string, unknown>,
  ): Promise<string | undefined>;
};

function makeDb(phone: string | null) {
  const executeTakeFirst = jest
    .fn()
    .mockResolvedValue(phone === null ? { phone: null } : { phone });
  const where = jest.fn().mockReturnValue({ executeTakeFirst });
  const select = jest.fn().mockReturnValue({ where });
  const selectFrom = jest.fn().mockReturnValue({ select });

  return {
    db: { selectFrom } as unknown as Kysely<Database>,
    selectFrom,
    executeTakeFirst,
  };
}

function makeGateway() {
  const sendWhatsappMessage = jest.fn().mockResolvedValue({ externalMessageId: 'wamid.test' });
  const requestWhatsappLocation = jest.fn().mockResolvedValue(undefined);

  return {
    gateway: {
      sendWhatsappMessage,
      requestWhatsappLocation,
    } as unknown as GatewayClientService,
    sendWhatsappMessage,
    requestWhatsappLocation,
  };
}

describe('NotificationsOutService WhatsApp destination', () => {
  it('resolves customer phone before sending a WhatsApp message', async () => {
    const { db } = makeDb('+59171234567');
    const { gateway, sendWhatsappMessage } = makeGateway();
    const service = new NotificationsOutService(db, gateway);
    const send = (service as unknown as SendOnly).send.bind(service);

    await expect(
      send('whatsapp', 'order_received', 'order-1', {
        customerId: 'customer-1',
        text: 'Pedido recibido',
      }),
    ).resolves.toBe('wamid.test');

    expect(sendWhatsappMessage).toHaveBeenCalledWith({
      customerId: 'customer-1',
      to: '+59171234567',
      text: 'Pedido recibido',
      imageUrl: undefined,
    });
  });

  it('resolves customer phone before requesting WhatsApp location', async () => {
    const { db } = makeDb('+59171234567');
    const { gateway, requestWhatsappLocation } = makeGateway();
    const service = new NotificationsOutService(db, gateway);
    const send = (service as unknown as SendOnly).send.bind(service);

    await expect(
      send('whatsapp', 'location_request', 'order-1', {
        customerId: 'customer-1',
        reason: 'delivery_location',
      }),
    ).resolves.toBeUndefined();

    expect(requestWhatsappLocation).toHaveBeenCalledWith({
      customerId: 'customer-1',
      orderId: 'order-1',
      to: '+59171234567',
      reason: 'delivery_location',
    });
  });

  it('does not call the gateway when the customer has no phone', async () => {
    const { db } = makeDb(null);
    const { gateway, sendWhatsappMessage } = makeGateway();
    const service = new NotificationsOutService(db, gateway);
    const send = (service as unknown as SendOnly).send.bind(service);

    await expect(
      send('whatsapp', 'order_received', 'order-1', {
        customerId: 'customer-1',
        text: 'Pedido recibido',
      }),
    ).rejects.toThrow('customer customer-1 has no phone');

    expect(sendWhatsappMessage).not.toHaveBeenCalled();
  });
});
