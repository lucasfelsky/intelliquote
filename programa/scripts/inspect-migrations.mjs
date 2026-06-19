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
    'SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM _prisma_migrations ORDER BY started_at',
  );
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.error(e);
} finally {
  await client.end();
}
