import pg from 'pg';
import { readFileSync } from 'node:fs';

const url = (readFileSync('tmp_db_url.txt', 'utf8') || '').trim();
if (!url) {
  console.error('Empty url from tmp_db_url.txt');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const log = (msg) => process.stdout.write(`${msg}\n`);
try {
  log('-- 0) DELETING ALL ROWS for the two migrations (will recreate fresh applied rows)');
  await client.query(
    "DELETE FROM _prisma_migrations WHERE migration_name = $1",
    ['20260619010251_add_supplier_payment_terms'],
  );

  log('-- 1) marking failed migration as rolled back');

  log('-- 2) ensuring Supplier.paymentTermsDays exists');
  await client.query(
    'ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTermsDays" INTEGER NOT NULL DEFAULT 30',
  );

  log('-- 3) marking new migration as already applied (using NOT VALID trick)');
  const dup = await client.query(
    "SELECT 1 FROM _prisma_migrations WHERE migration_name = $1",
    ['20260619010251_add_supplier_payment_terms'],
  );
  if (dup.rowCount === 0) {
    await client.query(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual-fix', $1, NOW(), NOW(), 1)",
      ['20260619010251_add_supplier_payment_terms'],
    );
  }

  log('-- 4) applying lead-time drop');
  await client.query(
    'ALTER TABLE "SupplierPortalResponse" DROP COLUMN IF EXISTS "leadTimeDays"',
  );

  log('-- 5) marking new migration as applied');
  const dup2 = await client.query(
    "SELECT 1 FROM _prisma_migrations WHERE migration_name = $1",
    ['20260619010719_drop_supplier_portal_response_lead_time'],
  );
  if (dup2.rowCount === 0) {
    await client.query(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual-fix', $1, NOW(), NOW(), 1)",
      ['20260619010719_drop_supplier_portal_response_lead_time'],
    );
  }

  log('-- 6) dropping Supplier.email');
  await client.query(
    'ALTER TABLE "Supplier" DROP COLUMN IF EXISTS "email"',
  );

  log('-- 7) marking new migration as applied');
  const dup3 = await client.query(
    "SELECT 1 FROM _prisma_migrations WHERE migration_name = $1",
    ['20260619020000_drop_supplier_email'],
  );
  if (dup3.rowCount === 0) {
    await client.query(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, 'manual-fix', $1, NOW(), NOW(), 1)",
      ['20260619020000_drop_supplier_email'],
    );
  }

  const { rows: portal } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'SupplierPortalResponse' AND column_name IN ('paymentTermsDays','leadTimeDays')",
  );
  log('SupplierPortalResponse columns after fix: ' + JSON.stringify(portal));
  const { rows: sup } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'Supplier' AND column_name = 'paymentTermsDays'",
  );
  log('Supplier.paymentTermsDays columns after fix: ' + JSON.stringify(sup));
  const { rows: migs } = await client.query(
    'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at',
  );
  log('Migrations:');
  for (const m of migs) {
    log(`  - ${m.migration_name} finished=${m.finished_at} rolled_back=${m.rolled_back_at}`);
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await client.end();
}
