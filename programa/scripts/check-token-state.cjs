const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    'SELECT id, "supplierContactId", "respondedAt", "responseId", "revokedAt" FROM "SupplierPortalToken" WHERE id IN (29, 31, 26, 24) ORDER BY id'
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });