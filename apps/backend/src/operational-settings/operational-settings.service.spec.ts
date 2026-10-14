import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { OperationalSettingsService } from './operational-settings.service';

function selectRow(row: unknown) {
  const builder: Record<string, unknown> = {};
  builder.selectAll = jest.fn(() => builder);
  builder.where = jest.fn(() => builder);
  builder.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(row);
  return builder;
}

describe('OperationalSettingsService ordersPaused', () => {
  it('exposes the pause flag through the public settings contract', async () => {
    const db = {
      selectFrom: jest.fn(() =>
        selectRow({
          rain_surcharge_enabled: false,
          rain_surcharge_amount: '0.00',
          business_opens_hour: 17,
          business_closes_hour: 23,
          restaurant_latitude: -17.75,
          restaurant_longitude: -63.18,
          orders_paused: true,
          pickup_enabled: false,
          restaurant_name: 'Don Zarco',
        }),
      ),
    } as unknown as Kysely<Database>;

    const service = new OperationalSettingsService(db);

    await expect(service.get()).resolves.toMatchObject({
      ordersPaused: true,
      pickupEnabled: false,
      rainSurchargeEnabled: false,
      businessOpensHour: 17,
      businessClosesHour: 23,
      restaurantName: 'Don Zarco',
    });
  });
});

describe('OperationalSettingsService restaurant profile', () => {
  const row = {
    restaurant_name: 'Buteco do Pica-Pau',
    restaurant_description: 'bar brasileño',
    restaurant_phone: null,
    restaurant_address: 'Calle Falsa 123',
    restaurant_maps_url: 'https://maps.example/buteco',
    restaurant_timezone: 'America/La_Paz',
    restaurant_locale: 'es-BO',
    currency_code: 'BOB',
    currency_symbol: 'Bs',
    hours_text: null,
    business_opens_hour: 19,
    business_closes_hour: 4,
    restaurant_latitude: -17.78,
    restaurant_longitude: -63.18,
    orders_paused: false,
    pickup_enabled: true,
    delivery_enabled: true,
    enabled_payment_methods: ['qr', 'cash'],
    greeting_message: null,
    farewell_message: 'Gracias por tu pedido',
    menu_video_url: null,
    menu_image_url: null,
  };

  it('builds the contract profile from the settings row', async () => {
    const db = { selectFrom: jest.fn(() => selectRow(row)) } as unknown as Kysely<Database>;

    await expect(new OperationalSettingsService(db).getProfile()).resolves.toEqual({
      contractVersion: 'v1',
      name: 'Buteco do Pica-Pau',
      description: 'bar brasileño',
      locale: 'es-BO',
      timezone: 'America/La_Paz',
      currency: { code: 'BOB', symbol: 'Bs' },
      phone: null,
      location: {
        address: 'Calle Falsa 123',
        mapsUrl: 'https://maps.example/buteco',
        latitude: -17.78,
        longitude: -63.18,
      },
      hours: {
        text: null,
        weekly: Array.from({ length: 7 }, () => ({ opens: '19:00', closes: '04:00' })),
      },
      ordering: {
        paused: false,
        pickupEnabled: true,
        deliveryEnabled: true,
        // Siempre en el mismo orden, sin importar cómo se guardaron.
        paymentMethods: ['cash', 'qr'],
      },
      messages: { greeting: null, farewell: 'Gracias por tu pedido' },
      menuMedia: { videoUrl: null, imageUrl: null },
    });
  });

  it('saves profile fields, clears optional texts with null and keeps required ones', async () => {
    const set = jest.fn();
    const builder: Record<string, unknown> = {};
    builder.set = jest.fn((values: unknown) => {
      set(values);
      return builder;
    });
    builder.where = jest.fn(() => builder);
    builder.returningAll = jest.fn(() => builder);
    builder.executeTakeFirstOrThrow = jest.fn().mockResolvedValue({
      ...row,
      rain_surcharge_enabled: false,
      rain_surcharge_amount: '0.00',
    });
    const db = { updateTable: jest.fn(() => builder) } as unknown as Kysely<Database>;

    await new OperationalSettingsService(db).update({
      restaurantDescription: '  bar brasileño  ',
      restaurantPhone: null,
      greetingMessage: '   ',
      currencyCode: 'brl',
      currencySymbol: 'R$',
      enabledPaymentMethods: ['qr', 'qr', 'cash'],
      deliveryEnabled: false,
    });

    const saved = set.mock.calls[0][0];
    expect(saved).toMatchObject({
      restaurant_description: 'bar brasileño',
      restaurant_phone: null,
      greeting_message: null,
      currency_code: 'BRL',
      currency_symbol: 'R$',
      enabled_payment_methods: ['qr', 'cash'],
      delivery_enabled: false,
    });
    // Lo que no vino en el PATCH no se toca.
    expect(saved).not.toHaveProperty('restaurant_timezone');
    expect(saved).not.toHaveProperty('restaurant_address');
    expect(saved).not.toHaveProperty('menu_video_url');
  });
});
