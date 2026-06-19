import pg from 'pg';
import { readFileSync } from 'node:fs';

const url = (readFileSync('tmp_db_url.txt', 'utf8') || '').trim();
if (!url) {
  console.error('Empty url from tmp_db_url.txt');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows } = await client.query(
    "SELECT indexname FROM pg_indexes WHERE indexname = 'PasswordResetToken_expiresAt_idx'",
  );
  console.log('indexes matching PasswordResetToken_expiresAt_idx:', JSON.stringify(rows, null, 2));
  const { rows: cols } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'Supplier' AND column_name = 'paymentTermsDays'",
  );
  console.log('Supplier.paymentTermsDays columns:', JSON.stringify(cols, null, 2));
  const { rows: portal } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'SupplierPortalResponse' AND column_name IN ('paymentTermsDays','leadTimeDays')",
  );
  console.log('SupplierPortalResponse columns:', JSON.stringify(portal, null, 2));
} catch (e) {
  console.error(e);
} finally {
  await client.end();
}
