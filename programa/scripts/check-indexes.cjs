const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT tablename, indexname, indexdef
       FROM pg_indexes
      WHERE tablename IN ('SupplierPortalResponse', 'SupplierPortalToken', 'QuoteResponse')
      ORDER BY tablename, indexname`
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });