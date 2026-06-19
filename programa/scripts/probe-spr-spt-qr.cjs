const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const cols = await c.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='SupplierPortalResponse' ORDER BY ordinal_position"
  );
  console.log('SPR columns:');
  console.log(cols.rows.map((r) => r.column_name).join(', '));
  const r = await c.query(
    `SELECT id, "portalTokenId", "quoteRequestId", "supplierId", "supplierContactId",
            currency, "paymentTermsDays", "submittedAt"
       FROM "SupplierPortalResponse" ORDER BY id DESC LIMIT 8`
  );
  console.table(r.rows);
  const qr = await c.query(
    `SELECT id, "quoteRequestId", "supplierId", currency, "paymentTermsDays", "updatedAt"
       FROM "QuoteResponse" ORDER BY id DESC LIMIT 8`
  );
  console.table(qr.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });