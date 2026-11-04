import pg, { type Pool, type QueryResultRow } from 'pg';

// Return ISO-8601 strings for TIMESTAMPTZ / TIMESTAMP and JS numbers for BIGINT counts
// so query rows match the exact TypeScript contracts across the app.
pg.types.setTypeParser(1184, (v: string) => new Date(v).toISOString());
pg.types.setTypeParser(1114, (v: string) => new Date(`${v}Z`).toISOString());
pg.types.setTypeParser(20, (v: string) => Number(v));

export interface ParsedDatabaseUrl {
  connectionString: string;
  ssl: false | { rejectUnauthorized: boolean };
  enableChannelBinding: boolean;
  isNeon: boolean;
  isPooled: boolean;
}

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/**
 * Normalize a Postgres / Neon connection string:
 * - Accepts standard `postgresql://` or `postgres://` URLs (pooled `-pooler` or direct)
 * - Strips accidental outer quotes or leading `psql ` pasted from the Neon Console
 * - Normalizes `sslmode` & `channel_binding=require` for `node-postgres` (`pg`)
 */
export function parseDatabaseUrl(raw: string): ParsedDatabaseUrl {
  let cleaned = raw.trim();
  if (!cleaned) {
    throw new Error('DATABASE_URL is empty. Paste your Neon Postgres connection string.');
  }

  // Strip accidental `psql ...` wrapper copied from Neon CLI snippet
  if (/^psql\s+/i.test(cleaned)) {
    cleaned = cleaned.replace(/^psql\s+/i, '').trim();
  }
  // Strip matching surrounding single or double quotes
  if (
    (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2) ||
    (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2)
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    throw new Error('Invalid DATABASE_URL format. Expected postgresql://USER:PASSWORD@HOST/DB?sslmode=require');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`Unsupported DATABASE_URL protocol "${url.protocol}". Expected postgresql:// or postgres://`);
  }

  const sslmode = url.searchParams.get('sslmode')?.toLowerCase();
  const sslParam = url.searchParams.get('ssl')?.toLowerCase();
  const channelBinding = url.searchParams.get('channel_binding')?.toLowerCase();
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';

  const useSsl =
    sslmode === 'disable' || sslParam === 'false' || sslParam === '0'
      ? false
      : isLocal && !sslmode && sslParam !== 'true' && sslParam !== '1'
        ? false
        : true;

  const enableChannelBinding = channelBinding === 'require';

  // Remove connection params handled explicitly via pg PoolConfig so pg-connection-string
  // neither overrides `ssl` nor logs SSL mode alias warnings on Neon endpoints.
  url.searchParams.delete('sslmode');
  url.searchParams.delete('ssl');
  url.searchParams.delete('uselibpqcompat');
  url.searchParams.delete('channel_binding');
  url.searchParams.delete('supa');
  url.searchParams.delete('pgbouncer');

  const isNeon = url.hostname.endsWith('.neon.tech') || url.hostname.includes('.neon.');
  const isPooled = url.hostname.includes('-pooler.');

  return {
    connectionString: url.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    enableChannelBinding,
    isNeon,
    isPooled,
  };
}

/** Resolve the configured Postgres URL (supports `DATABASE_URL` and Vercel/Neon `POSTGRES_URL*` aliases). */
export function resolveDatabaseUrl(opts: { preferDirect?: boolean } = {}): string {
  const keys = opts.preferDirect
    ? ['DATABASE_URL_UNPOOLED', 'DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'POSTGRES_URL']
    : ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'];

  for (const key of keys) {
    const val = process.env[key]?.trim();
    if (val) return val;
  }
  throw new Error('Missing DATABASE_URL environment variable. Set your Neon Postgres URL in .env.local.');
}

const globalForPg = globalThis as unknown as {
  __flashxPgPool?: Pool;
  __flashxPgUrl?: string;
};

/** Shared `pg.Pool` singleton (handles Neon scale-to-zero idle disconnects gracefully). */
export function pool(): Pool {
  const raw = resolveDatabaseUrl();
  if (!globalForPg.__flashxPgPool || globalForPg.__flashxPgUrl !== raw) {
    const parsed = parseDatabaseUrl(raw);
    const p = new pg.Pool({
      connectionString: parsed.connectionString,
      ssl: parsed.ssl,
      ...(parsed.enableChannelBinding ? { enableChannelBinding: true } : {}),
      max: 10,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
    // Neon suspends idle compute after inactivity; absorb background idle socket closes cleanly
    // so the pool transparently reconnects on the next query without crashing Node.
    p.on('error', (err) => {
      console.warn('[db pool] idle client error:', err.message);
    });
    globalForPg.__flashxPgPool = p;
    globalForPg.__flashxPgUrl = raw;
  }
  return globalForPg.__flashxPgPool;
}

/** Run a parameterized SQL query directly against Neon Postgres. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await pool().query<T>(text, values);
  return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
}

// ---------------------------------------------------------------------------
// Lightweight, strictly parameterized table query builder (`db().from(...)`)
// ---------------------------------------------------------------------------

export interface DbError {
  message: string;
  code?: string;
}

export interface DbResult<T> {
  data: T | null;
  error: DbError | null;
  count?: number | null;
}

const ALLOWED_TABLES = new Set([
  'quizzes',
  'questions',
  'options',
  'sessions',
  'participants',
  'answers',
  'admins',
  'uploaded_assets',
]);

const JSONB_COLUMNS = new Set(['theme', 'quiz_snapshot']);

function assertTable(name: string): string {
  if (!ALLOWED_TABLES.has(name)) {
    throw new Error(`Disallowed table identifier: ${name}`);
  }
  return name;
}

function assertIdent(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(trimmed)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return trimmed;
}

function prepareValue(col: string, val: unknown): unknown {
  if (val !== null && val !== undefined && JSONB_COLUMNS.has(col) && typeof val === 'object' && !Buffer.isBuffer(val)) {
    return JSON.stringify(val);
  }
  return val;
}

function parseColumnList(cols: string): string {
  const trimmed = cols.trim();
  if (!trimmed || trimmed === '*') return '*';
  return trimmed
    .split(',')
    .map((c) => assertIdent(c))
    .join(', ');
}

type FilterFn = (params: unknown[]) => string;

class TableQuery<T = any> implements PromiseLike<DbResult<T>> {
  private readonly table: string;
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private selectCols = '*';
  private returningCols: string | null = null;
  private countHead = false;
  private payloadRows: Record<string, unknown>[] = [];
  private updatePatch: Record<string, unknown> = {};
  private conflictCols: string[] = [];
  private filters: FilterFn[] = [];
  private orders: string[] = [];
  private limitVal: number | null = null;
  private offsetVal: number | null = null;
  private cardinality: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(table: string) {
    this.table = assertTable(table);
  }

  select(cols = '*', opts?: { count?: 'exact'; head?: boolean }): this {
    if (this.op === 'select') {
      this.selectCols = parseColumnList(cols);
      if (opts?.count === 'exact' && opts?.head) {
        this.countHead = true;
      }
    } else {
      this.returningCols = parseColumnList(cols);
    }
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.op = 'insert';
    this.payloadRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.op = 'update';
    this.updatePatch = patch;
    return this;
  }

  upsert(rows: Record<string, unknown> | Record<string, unknown>[], opts: { onConflict: string }): this {
    this.op = 'upsert';
    this.payloadRows = Array.isArray(rows) ? rows : [rows];
    this.conflictCols = opts.onConflict.split(',').map((c) => assertIdent(c));
    return this;
  }

  delete(): this {
    this.op = 'delete';
    return this;
  }

  eq(col: string, val: unknown): this {
    const id = assertIdent(col);
    this.filters.push((params) => {
      params.push(val);
      return `${id} = $${params.length}`;
    });
    return this;
  }

  in(col: string, vals: readonly unknown[]): this {
    const id = assertIdent(col);
    this.filters.push((params) => {
      if (vals.length === 0) return '1 = 0';
      const placeholders = vals.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `${id} IN (${placeholders.join(', ')})`;
    });
    return this;
  }

  is(col: string, val: null | boolean): this {
    const id = assertIdent(col);
    if (val === null) {
      this.filters.push(() => `${id} IS NULL`);
    } else if (typeof val === 'boolean') {
      this.filters.push(() => `${id} IS ${val ? 'TRUE' : 'FALSE'}`);
    } else {
      throw new Error(`Unsupported .is() value for ${id}`);
    }
    return this;
  }

  not(col: string, operator: 'is', val: null | boolean): this {
    const id = assertIdent(col);
    if (operator !== 'is') throw new Error(`Unsupported .not() operator: ${operator}`);
    if (val === null) {
      this.filters.push(() => `${id} IS NOT NULL`);
    } else {
      this.filters.push(() => `${id} IS NOT ${val ? 'TRUE' : 'FALSE'}`);
    }
    return this;
  }

  lt(col: string, val: unknown): this {
    const id = assertIdent(col);
    this.filters.push((params) => {
      params.push(val);
      return `${id} < $${params.length}`;
    });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    const id = assertIdent(col);
    const dir = opts?.ascending === false ? 'DESC' : 'ASC';
    this.orders.push(`${id} ${dir}`);
    return this;
  }

  limit(n: number): this {
    this.limitVal = Math.max(0, Math.floor(n));
    return this;
  }

  range(from: number, to: number): this {
    const start = Math.max(0, Math.floor(from));
    const end = Math.max(start - 1, Math.floor(to));
    this.offsetVal = start;
    this.limitVal = end - start + 1;
    return this;
  }

  single(): this {
    this.cardinality = 'single';
    return this;
  }

  maybeSingle(): this {
    this.cardinality = 'maybeSingle';
    return this;
  }

  private buildWhere(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    return ` WHERE ${this.filters.map((f) => f(params)).join(' AND ')}`;
  }

  async execute(): Promise<DbResult<T>> {
    try {
      const params: unknown[] = [];
      let sql = '';

      if (this.op === 'select') {
        if (this.countHead) {
          sql = `SELECT count(*)::int AS count FROM ${this.table}${this.buildWhere(params)}`;
          const res = await query<{ count: number }>(sql, params);
          return { data: null, error: null, count: res.rows[0]?.count ?? 0 };
        }
        sql = `SELECT ${this.selectCols} FROM ${this.table}${this.buildWhere(params)}`;
        if (this.orders.length > 0) sql += ` ORDER BY ${this.orders.join(', ')}`;
        if (this.limitVal !== null) {
          params.push(this.limitVal);
          sql += ` LIMIT $${params.length}`;
        }
        if (this.offsetVal !== null) {
          params.push(this.offsetVal);
          sql += ` OFFSET $${params.length}`;
        }
      } else if (this.op === 'insert' || this.op === 'upsert') {
        if (this.payloadRows.length === 0) {
          return { data: ([] as unknown) as T, error: null };
        }
        const cols = Object.keys(this.payloadRows[0])
          .filter((k) => this.payloadRows[0][k] !== undefined)
          .map((c) => assertIdent(c));
        const tuples = this.payloadRows.map((row) => {
          const ph = cols.map((c) => {
            params.push(prepareValue(c, row[c] ?? null));
            return `$${params.length}`;
          });
          return `(${ph.join(', ')})`;
        });
        sql = `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES ${tuples.join(', ')}`;
        if (this.op === 'upsert') {
          const updateCols = cols.filter((c) => !this.conflictCols.includes(c));
          if (updateCols.length > 0) {
            sql += ` ON CONFLICT (${this.conflictCols.join(', ')}) DO UPDATE SET ${updateCols
              .map((c) => `${c} = EXCLUDED.${c}`)
              .join(', ')}`;
          } else {
            sql += ` ON CONFLICT (${this.conflictCols.join(', ')}) DO NOTHING`;
          }
        }
        if (this.returningCols) {
          sql += ` RETURNING ${this.returningCols}`;
        }
      } else if (this.op === 'update') {
        const entries = Object.entries(this.updatePatch).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
          return { data: (this.cardinality === 'many' ? [] : null) as T, error: null };
        }
        const sets = entries.map(([k, v]) => {
          const col = assertIdent(k);
          params.push(prepareValue(col, v));
          return `${col} = $${params.length}`;
        });
        sql = `UPDATE ${this.table} SET ${sets.join(', ')}${this.buildWhere(params)}`;
        if (this.returningCols) {
          sql += ` RETURNING ${this.returningCols}`;
        }
      } else if (this.op === 'delete') {
        sql = `DELETE FROM ${this.table}${this.buildWhere(params)}`;
        if (this.returningCols) {
          sql += ` RETURNING ${this.returningCols}`;
        }
      }

      const res = await query(sql, params);
      const rows = res.rows;

      if (this.cardinality === 'single') {
        if (rows.length !== 1) {
          return {
            data: null,
            error: {
              message: rows.length === 0 ? 'Row not found' : 'Multiple rows returned',
              code: 'PGRST116',
            },
          };
        }
        return { data: rows[0] as T, error: null };
      }

      if (this.cardinality === 'maybeSingle') {
        if (rows.length === 0) return { data: null, error: null };
        if (rows.length > 1) return { data: null, error: { message: 'Multiple rows returned' } };
        return { data: rows[0] as T, error: null };
      }

      return { data: (rows as unknown) as T, error: null };
    } catch (err) {
      const pgErr = err as { message?: string; code?: string };
      return {
        data: null,
        error: {
          message: pgErr?.message || String(err),
          code: pgErr?.code,
        },
      };
    }
  }

  then<TResult1 = DbResult<T>, TResult2 = never>(
    onfulfilled?: ((value: DbResult<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export interface DbClient {
  from<T = any>(table: string): TableQuery<T>;
  rpc(fn: 'session_answer_counts', args: { sid: string }): Promise<DbResult<{ participant_id: string; answered: number }[]>>;
}

const clientSingleton: DbClient = {
  from<T = any>(table: string) {
    return new TableQuery<T>(table);
  },
  async rpc(fn: 'session_answer_counts', args: { sid: string }) {
    if (fn !== 'session_answer_counts') {
      return { data: null, error: { message: `Unknown RPC: ${fn}` } };
    }
    try {
      const res = await query<{ participant_id: string; answered: number }>(
        `SELECT a.participant_id, count(*)::int AS answered
         FROM answers a
         JOIN participants p ON p.id = a.participant_id
         WHERE p.session_id = $1
         GROUP BY a.participant_id`,
        [args.sid],
      );
      return { data: res.rows, error: null };
    } catch (err) {
      const pgErr = err as { message?: string; code?: string };
      return { data: null, error: { message: pgErr?.message || String(err), code: pgErr?.code } };
    }
  },
};

/** Neon Postgres query client. Server only — never import from client components. */
export function db(): DbClient {
  return clientSingleton;
}

/** Throw on a DB error, return data otherwise. */
export function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what = 'query'): T {
  if (res.error) throw new Error(`${what} failed: ${res.error.message}`);
  return res.data as T;
}
