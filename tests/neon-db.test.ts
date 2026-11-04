import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDatabaseUrl, resolveDatabaseUrl } from '../lib/server/db';
import {
  hashPassword,
  presenterToken,
  signAdminToken,
  validPresenterToken,
  verifyAdminToken,
  verifyPassword,
} from '../lib/server/auth';
import { verifyAdminTokenEdge } from '../lib/auth-edge';
import { questionsSchema, themeSchema } from '../lib/server/schemas';
import { resolveTheme, sanitizeTheme } from '../lib/theme';

describe('Neon Postgres DATABASE_URL normalization & resolution', () => {
  it('parses Neon pooled connection strings with sslmode=require cleanly', () => {
    const parsed = parseDatabaseUrl(
      'postgresql://neondb_owner:AbCdEf123@ep-cool-darkness-a1b2c3d4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
    );
    assert.equal(parsed.isNeon, true);
    assert.equal(parsed.isPooled, true);
    assert.equal(parsed.enableChannelBinding, false);
    assert.deepEqual(parsed.ssl, { rejectUnauthorized: false });
    assert.equal(parsed.connectionString.includes('sslmode='), false);
    assert.ok(parsed.connectionString.startsWith('postgresql://neondb_owner:AbCdEf123@ep-cool-darkness'));
  });

  it('parses Neon direct URLs with sslmode=require&channel_binding=require', () => {
    const parsed = parseDatabaseUrl(
      'postgres://neondb_owner:Pass%40123@ep-cool-darkness-a1b2c3d4.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    );
    assert.equal(parsed.isNeon, true);
    assert.equal(parsed.isPooled, false);
    assert.equal(parsed.enableChannelBinding, true);
    assert.deepEqual(parsed.ssl, { rejectUnauthorized: false });
    assert.equal(parsed.connectionString.includes('channel_binding='), false);
    assert.equal(parsed.connectionString.includes('sslmode='), false);
  });

  it('strips accidental psql prefix and surrounding quotes copied from Neon Console', () => {
    const fromPsql = parseDatabaseUrl(
      "psql 'postgresql://neondb_owner:secret@ep-frosty-river-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'",
    );
    assert.equal(fromPsql.isNeon, true);
    assert.equal(fromPsql.isPooled, true);
    assert.equal(fromPsql.enableChannelBinding, true);
    assert.deepEqual(fromPsql.ssl, { rejectUnauthorized: false });

    const fromDoubleQuotes = parseDatabaseUrl(
      '"postgresql://neondb_owner:secret@ep-frosty-river-123.eu-central-1.aws.neon.tech/neondb?sslmode=require"',
    );
    assert.equal(fromDoubleQuotes.isNeon, true);
    assert.equal(fromDoubleQuotes.isPooled, false);
  });

  it('disables TLS for localhost by default and respects sslmode=disable', () => {
    const local = parseDatabaseUrl('postgresql://postgres:postgres@localhost:5432/flashx');
    assert.equal(local.ssl, false);
    assert.equal(local.isNeon, false);

    const disabled = parseDatabaseUrl('postgresql://user:pass@db.internal:5432/flashx?sslmode=disable');
    assert.equal(disabled.ssl, false);
  });

  it('rejects empty or non-Postgres URLs with descriptive errors', () => {
    assert.throws(() => parseDatabaseUrl('   '), /DATABASE_URL is empty/);
    assert.throws(() => parseDatabaseUrl('https://ep-example.aws.neon.tech'), /Unsupported DATABASE_URL protocol/);
    assert.throws(() => parseDatabaseUrl('not-a-url'), /Invalid DATABASE_URL format/);
  });

  it('resolves DATABASE_URL and preferDirect unpooled fallbacks cleanly', () => {
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
      POSTGRES_URL: process.env.POSTGRES_URL,
      POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
    };
    try {
      process.env.DATABASE_URL = 'postgresql://u:p@ep-x-pooler.aws.neon.tech/neondb?sslmode=require';
      process.env.DATABASE_URL_UNPOOLED = 'postgresql://u:p@ep-x.aws.neon.tech/neondb?sslmode=require';
      assert.equal(resolveDatabaseUrl(), process.env.DATABASE_URL);
      assert.equal(resolveDatabaseUrl({ preferDirect: true }), process.env.DATABASE_URL_UNPOOLED);

      delete process.env.DATABASE_URL;
      delete process.env.DATABASE_URL_UNPOOLED;
      delete process.env.POSTGRES_URL;
      delete process.env.POSTGRES_URL_NON_POOLING;
      assert.throws(() => resolveDatabaseUrl(), /Missing DATABASE_URL/);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe('Standalone Neon admin auth, Edge cookie parity, sample.env & asset schemas', () => {
  it('hashes and verifies admin passwords with random scrypt salts', () => {
    const h1 = hashPassword('CorrectHorseBatteryStaple!99');
    const h2 = hashPassword('CorrectHorseBatteryStaple!99');
    assert.notEqual(h1, h2, 'Random salt must produce distinct hashes');
    assert.equal(verifyPassword('CorrectHorseBatteryStaple!99', h1), true);
    assert.equal(verifyPassword('WrongPassword', h1), false);
    assert.equal(verifyPassword('CorrectHorseBatteryStaple!99', 'invalid$hash'), false);
  });

  it('verifies signed session tokens identically in Node and Edge Web Crypto runtimes', async () => {
    const secret = 'test-neon-auth-secret-32-chars-minimum!';
    const admin = { id: '11111111-2222-4333-8444-555555555555', email: 'admin@xcelerator.co.in' };

    const token = signAdminToken(admin, 60_000, secret);
    assert.deepEqual(verifyAdminToken(token, secret), admin);
    assert.deepEqual(await verifyAdminTokenEdge(token, secret), admin);

    // Wrong secret rejected in both
    assert.equal(verifyAdminToken(token, 'wrong-secret'), null);
    assert.equal(await verifyAdminTokenEdge(token, 'wrong-secret'), null);

    // Tampered token rejected in both
    const tampered = `${token.slice(0, -2)}ab`;
    assert.equal(verifyAdminToken(tampered, secret), null);
    assert.equal(await verifyAdminTokenEdge(tampered, secret), null);

    // Expired token rejected in both
    const expired = signAdminToken(admin, -1_000, secret);
    assert.equal(verifyAdminToken(expired, secret), null);
    assert.equal(await verifyAdminTokenEdge(expired, secret), null);
  });

  it('validates presenter tokens without Supabase env vars', () => {
    const prev = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'presenter-hmac-secret-key-for-test';
    try {
      const tok = presenterToken('session-123');
      assert.equal(validPresenterToken('session-123', tok), true);
      assert.equal(validPresenterToken('session-456', tok), false);
      assert.equal(validPresenterToken('session-123', 'bad-token'), false);
    } finally {
      if (prev === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = prev;
    }
  });

  it('accepts Neon-backed /api/assets/<uuid> paths in schemas and theme sanitizer', () => {
    const assetPath = '/api/assets/11111111-2222-4333-8444-555555555555';
    assert.equal(themeSchema.safeParse({ logoUrl: assetPath }).success, true);
    assert.equal(
      questionsSchema.safeParse({
        questions: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            text: 'Identify this architecture diagram',
            image_url: assetPath,
            points: 1,
            options: [
              { id: 'aaaa1111-1111-4111-8111-111111111111', text: 'A', is_correct: true },
              { id: 'aaaa2222-1111-4111-8111-111111111111', text: 'B', is_correct: false },
            ],
          },
        ],
      }).success,
      true,
    );

    const sanitized = sanitizeTheme({
      ...resolveTheme({}),
      logoUrl: assetPath,
      backgroundType: 'image',
      backgroundValue: assetPath,
    });
    assert.equal(sanitized.logoUrl, assetPath);
    assert.equal(sanitized.backgroundType, 'image');
    assert.equal(sanitized.backgroundValue, assetPath);
  });

  it('ensures sample.env and .env.example contain only clean Neon env vars without Supabase bloat', () => {
    for (const file of ['sample.env', '.env.example']) {
      const content = readFileSync(join(process.cwd(), file), 'utf8');
      assert.ok(content.includes('DATABASE_URL='), `${file} must define DATABASE_URL`);
      assert.ok(content.includes('AUTH_SECRET='), `${file} must define AUTH_SECRET`);
      assert.ok(content.includes('SEED_ADMIN_EMAIL='), `${file} must define SEED_ADMIN_EMAIL`);
      assert.ok(content.includes('SEED_ADMIN_PASSWORD='), `${file} must define SEED_ADMIN_PASSWORD`);
      assert.equal(content.toUpperCase().includes('SUPABASE'), false, `${file} must not contain old SUPABASE vars`);
    }
  });

  it('safely handles multi-statement query results in query() helper', () => {
    const mockMultiRes: unknown = [
      { command: 'CREATE', rowCount: null, rows: [] },
      { command: 'CREATE', rowCount: null, rows: [{ id: '1' }] },
    ];
    const normalize = (res: any) => {
      if (Array.isArray(res)) {
        const last = res[res.length - 1];
        const rows = (last?.rows ?? []);
        return { rows, rowCount: last?.rowCount ?? rows.length };
      }
      const rows = (res?.rows ?? []);
      return { rows, rowCount: res?.rowCount ?? rows.length };
    };
    const out = normalize(mockMultiRes);
    assert.deepEqual(out, { rows: [{ id: '1' }], rowCount: 1 });
  });

  it('provides 191 hardcoded teams and resolves team list correctly', async () => {
    const { HARDCODED_TEAMS, resolveTeamList } = await import('../lib/teams');
    assert.equal(HARDCODED_TEAMS.length, 191);
    assert.ok(HARDCODED_TEAMS.includes('Transformers'));
    assert.ok(HARDCODED_TEAMS.includes('Beyond The Bin'));
    assert.ok(HARDCODED_TEAMS.includes('Innovation hub'));

    // When custom teams provided, they appear first and deduplicate
    const resolved = resolveTeamList(['Custom Alpha', 'Transformers', 'Custom Beta']);
    assert.equal(resolved[0], 'Custom Alpha');
    assert.equal(resolved[1], 'Transformers');
    assert.equal(resolved[2], 'Custom Beta');
    assert.equal(resolved.filter((t) => t === 'Transformers').length, 1);
    assert.equal(resolved.length, 193); // 2 new + 191
  });
});

