const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(
    'SELECT id, "respondedAt" FROM "SupplierPortalToken" WHERE id = 29'
  );
  console.table(r.rows);
  await c.end();
})();