const { Client } = require('pg');

(async () => {
  const url = require('fs').readFileSync('tmp_db_url.txt', 'utf8').trim();
  const c = new Client({ connectionString: url });
  await c.connect();
  const r = await c.query(
      `SELECT id, "supplierContactId", LEFT("tokenHash", 12) AS hash_prefix,
              "expiresAt", "revokedAt"
       FROM "SupplierPortalToken"
      WHERE id IN (27, 28)
      ORDER BY id`
  );
  console.table(r.rows);
  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});