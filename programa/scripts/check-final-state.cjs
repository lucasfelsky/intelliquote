const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const t = await c.query(
    `SELECT id, "responseId", "respondedAt", "revokedAt"
       FROM "SupplierPortalToken"
      WHERE id IN (33, 34, 35)
      ORDER BY id DESC`
  );
  console.log('Latest tokens:');
  console.table(t.rows);
  const items = await c.query(
    `SELECT id, "responseId", "quoteRequestItemId", "unitPrice", "quantity",
            "totalPrice", "leadTimeDays"
       FROM "SupplierPortalResponseItem"
      WHERE "responseId" = 19`
  );
  console.log('SPR id=19 items:');
  console.table(items.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });