import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { parseDatabaseUrl, resolveDatabaseUrl } from '../lib/server/db';

export async function applyMigrations() {
  const rawConn = resolveDatabaseUrl({ preferDirect: true });
  const parsed = parseDatabaseUrl(rawConn);

  const client = new pg.Client({
    connectionString: parsed.connectionString,
    ssl: parsed.ssl,
    ...(parsed.enableChannelBinding ? { enableChannelBinding: true } : {}),
  });

  await client.connect();
  try {
    const dir = join(process.cwd(), 'supabase/migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query(sql);
      console.log(`✓ Applied supabase/migrations/${file}`);
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  applyMigrations().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
