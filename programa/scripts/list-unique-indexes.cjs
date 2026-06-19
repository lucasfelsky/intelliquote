const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    `SELECT n.nspname AS schema,
            t.relname AS table,
            i.relname AS index,
            pg_get_indexdef(i.oid) AS def,
            ix.indisunique AS is_unique
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND ix.indisunique = true
      ORDER BY t.relname, i.relname`
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });