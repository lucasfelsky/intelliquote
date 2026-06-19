const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE conrelid = '\"SupplierPortalResponse\"'::regclass AND contype = 'u'"
  );
  console.log('--- SupplierPortalResponse unique constraints ---');
  console.table(r.rows);
  const r2 = await c.query(
    "SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE conrelid = '\"QuoteResponse\"'::regclass AND contype = 'u'"
  );
  console.log('--- QuoteResponse unique constraints ---');
  console.table(r2.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });