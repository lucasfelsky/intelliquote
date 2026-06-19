const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    'SELECT id, "portalTokenId", "quoteRequestId", "supplierId", "totalPrice", "paymentTermsDays" FROM "SupplierPortalResponse" ORDER BY id DESC LIMIT 10'
  );
  console.table(r.rows);
  const r2 = await c.query(
    'SELECT id, "responseId", "quoteRequestItemId", "unitPrice", "quantity", "totalPrice", "leadTimeDays" FROM "SupplierPortalResponseItem" WHERE "responseId" IN (SELECT id FROM "SupplierPortalResponse" ORDER BY id DESC LIMIT 2) ORDER BY "responseId", id'
  );
  console.table(r2.rows);
  await c.end();
})();