const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE contype = 'u' AND conrelid::regclass::text IN ('SupplierPortalResponse', 'SupplierPortalResponseItem', 'SupplierPortalToken', 'QuoteResponse') ORDER BY tbl"
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });