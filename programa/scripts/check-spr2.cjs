const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    'SELECT id, "portalTokenId", "supplierContactId", "submittedAt", "paymentTermsDays" FROM "SupplierPortalResponse" WHERE id > 5 ORDER BY id'
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });