const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "SELECT conname, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE conrelid = '\"SupplierPortalResponse\"'::regclass"
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });