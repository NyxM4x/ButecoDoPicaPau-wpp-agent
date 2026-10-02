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
    });
  });
});
