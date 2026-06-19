const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    'SELECT id, "quoteRequestId", "supplierId", "portalTokenId", "submittedAt" FROM "SupplierPortalResponse" ORDER BY id DESC LIMIT 3'
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });