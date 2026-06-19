const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "SELECT table_name, constraint_name FROM information_schema.table_constraints WHERE constraint_type = 'UNIQUE' AND table_name IN ('SupplierPortalResponse', 'SupplierPortalResponseItem', 'SupplierPortalToken', 'QuoteResponse')"
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });