import { Kysely } from 'kysely';
import { Database } from '../database/types';
import { DeliveryService } from './delivery.service';

describe('DeliveryService.quoteStandalone', () => {
  it('includes the active rain surcharge in the quoted amount', async () => {
    const selectBuilder: Record<string, unknown> = {};
    selectBuilder.selectAll = jest.fn(() => selectBuilder);
    selectBuilder.where = jest.fn(() => selectBuilder);
    selectBuilder.executeTakeFirst = jest.fn().mockResolvedValue(undefined);

    const insertBuilder: Record<string, unknown> = {};
    const values = jest.fn((value: Record<string, unknown>) => {
      insertBuilder.__values = value;
      return insertBuilder;
    });
    insertBuilder.values = values;
    insertBuilder.onConflict = jest.fn(() => insertBuilder);
    insertBuilder.returningAll = jest.fn(() => insertBuilder);
    insertBuilder.executeTakeFirst = jest.fn(async () => {
      const row = insertBuilder.__values as Record<string, unknown>;
      return {
        id: 'quote-1',
        status: row.status,
        distance_meters: row.distance_meters,
        fee_amount: row.fee_amount,
        error_code: row.error_code,
      };
    });

    const db = {
      selectFrom: jest.fn(() => selectBuilder),
      insertInto: jest.fn(() => insertBuilder),
    } as unknown as Kysely<Database>;

    const service = new DeliveryService(
      db,
      {
        feeForMeters: jest.fn().mockResolvedValue({
          ok: true,
          amount: 15,
          bandIndex: 3,
        }),
      } as never,
      {
        metersBetween: jest.fn().mockResolvedValue({
          meters: 3200,
          source: 'mapbox',
        }),
      } as never,
      {
        getRow: jest.fn().mockResolvedValue({
          restaurant_latitude: -17.75,
          restaurant_longitude: -63.18,
          rain_surcharge_enabled: true,
          rain_surcharge_amount: '3.00',
        }),
      } as never,
    );

    await expect(
      service.quoteStandalone({ latitude: -17.8, longitude: -63.2 }, 'quote-key-1'),
    ).resolves.toMatchObject({
      status: 'quoted',
      distanceMeters: 3200,
      feeAmount: 18,
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        fee_amount: '18.00',
        distance_meters: 3200,
        status: 'quoted',
      }),
    );
  });
});
