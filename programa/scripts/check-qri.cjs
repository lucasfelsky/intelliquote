const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    'SELECT id, "responseId", "quoteRequestItemId" FROM "QuoteResponseItem" WHERE "responseId" IN (SELECT id FROM "QuoteResponse" WHERE "quoteRequestId" = 2) ORDER BY "responseId", id'
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });