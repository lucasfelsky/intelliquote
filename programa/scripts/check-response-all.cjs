const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    'SELECT id, "portalTokenId", "supplierContactId", currency, "totalPrice", "paymentTermsDays" FROM "SupplierPortalResponse" ORDER BY id DESC'
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });