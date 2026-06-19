const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
  );
  console.log(r.rows.map((x) => x.tablename).join(', '));
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });