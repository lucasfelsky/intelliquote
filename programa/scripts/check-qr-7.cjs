const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const qr = await c.query(
    `SELECT id, "quoteRequestId", "supplierId", "offeredPrice", currency,
            "exchangeRate", "totalLandedCost", "offeredIncoterm",
            "paymentTermsDays", "leadTimeDays", "version", "updatedAt"
       FROM "QuoteResponse"
      WHERE id = 7`
  );
  console.log('QuoteResponse id=7 (post-update):');
  console.table(qr.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });