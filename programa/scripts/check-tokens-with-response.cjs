const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const all = await c.query(
    `SELECT id, "responseId", "respondedAt"
       FROM "SupplierPortalToken"
       WHERE "responseId" IS NOT NULL
       ORDER BY id DESC`
  );
  console.log('Tokens with responseId set:');
  console.table(all.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });