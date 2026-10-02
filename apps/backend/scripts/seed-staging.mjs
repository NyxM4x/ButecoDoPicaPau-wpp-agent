import pg from 'pg';

const { Client } = pg;

if (process.env.STAGING_SEED_CONFIRM !== 'zarco-staging-only') {
  console.error(
    'Refusing to seed. Set STAGING_SEED_CONFIRM=zarco-staging-only only on the isolated staging database.',
  );
  process.exit(2);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error('DATABASE_URL is required.');
  process.exit(2);
}

const client = new Client({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : undefined,
});

const lat =
  process.env.STAGING_RESTAURANT_LAT === undefined
    ? null
    : Number(process.env.STAGING_RESTAURANT_LAT);
const lng =
  process.env.STAGING_RESTAURANT_LNG === undefined
    ? null
    : Number(process.env.STAGING_RESTAURANT_LNG);

if ((lat === null) !== (lng === null)) {
  console.error('Set both STAGING_RESTAURANT_LAT and STAGING_RESTAURANT_LNG, or neither.');
  process.exit(2);
}
if (
  (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
  (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))
) {
  console.error('Invalid staging restaurant coordinates.');
  process.exit(2);
}

await client.connect();

try {
  await client.query('begin');

  const categoryId = async (name, sortOrder) => {
    const existing = await client.query(
      'select id from categories where name = $1 order by created_at asc limit 1',
      [name],
    );
    if (existing.rowCount > 0) return existing.rows[0].id;

    const inserted = await client.query(
      'insert into categories (name, sort_order, is_active) values ($1, $2, true) returning id',
      [name, sortOrder],
    );
    return inserted.rows[0].id;
  };

  const platosCategoryId = await categoryId('Platos Staging', 998);
  const bebidasCategoryId = await categoryId('Bebidas Staging', 999);

  const products = [
    ['STG-PLATO-01', 'Plato de prueba', platosCategoryId, '25.00', 1],
    ['STG-BEBIDA-01', 'Bebida de prueba', bebidasCategoryId, '10.00', 2],
  ];

  for (const [code, name, productCategoryId, price, sortOrder] of products) {
    await client.query(
      `
        insert into products
          (code, name, category_id, price, is_active, is_available, sort_order)
        values ($1, $2, $3, $4, true, true, $5)
        on conflict (code) do update
        set
          name = excluded.name,
          category_id = excluded.category_id,
          price = excluded.price,
          is_active = true,
          is_available = true,
          sort_order = excluded.sort_order,
          updated_at = now()
      `,
      [code, name, productCategoryId, price, sortOrder],
    );
  }

  const settings = [
    false,
    0,
    0,
    23,
    lat,
    lng,
  ];
  await client.query(
    `
      update operational_settings
      set
        orders_paused = $1,
        rain_surcharge_enabled = false,
        rain_surcharge_amount = $2,
        business_opens_hour = $3,
        business_closes_hour = $4,
        restaurant_latitude = coalesce($5, restaurant_latitude),
        restaurant_longitude = coalesce($6, restaurant_longitude),
        updated_at = now()
      where id = true
    `,
    settings,
  );

  await client.query(
    `
      insert into cash_register_sessions
        (status, opened_at, opened_by, opening_amount, notes)
      select 'open', now(), 'staging-seed', 0, 'Caja exclusiva de staging'
      where not exists (
        select 1 from cash_register_sessions where status = 'open'
      )
    `,
  );

  await client.query('commit');

  console.log(
    JSON.stringify(
      {
        ok: true,
        categories: ['Platos Staging', 'Bebidas Staging'],
        products: products.map(([code]) => code),
        cashRegisterOpen: true,
        automaticDeliveryCoordinatesConfigured: lat !== null && lng !== null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query('rollback');
  console.error(error instanceof Error ? error.message : 'staging seed failed');
  process.exitCode = 1;
} finally {
  await client.end();
}
