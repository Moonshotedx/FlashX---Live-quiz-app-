import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

async function main() {
  const rawConn =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL;
  if (!rawConn) {
    throw new Error('Missing POSTGRES_URL_NON_POOLING, POSTGRES_URL, or DATABASE_URL');
  }

  // Strip sslmode parameter so pg uses our explicit TLS config cleanly with Supabase pooler/direct certs
  const url = new URL(rawConn);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('supa');

  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0001_init.sql'), 'utf8');
    await client.query(sql);
    console.log('✓ Applied supabase/migrations/0001_init.sql');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
