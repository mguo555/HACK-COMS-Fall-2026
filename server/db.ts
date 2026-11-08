// The database connection. Production runs real Postgres (DATABASE_URL, see compose.yaml).
// Without DATABASE_URL, for development and tests, it runs PGlite: the same Postgres, compiled to
// run inside Node, storing its files in <dataDir>/pglite. Same SQL either way.
import { PGlite, types as pgliteTypes } from '@electric-sql/pglite';
import path from 'node:path';
import pg from 'pg';

/** Something you can run SQL on: the database, or a transaction in progress. */
export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction: all of it happens, or none of it does. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  /** 'postgres' or 'pglite', for the startup log. */
  readonly kind: string;
}

// COUNT(*) and BIGINT columns come back as 64-bit numbers, which both drivers hand over as
// strings by default. Every one of ours (ids, counts, millisecond timestamps) fits in a JS number.
const INT8 = 20;
pg.types.setTypeParser(INT8, (value) => Number(value));

export async function openDb(databaseUrl: string | null, dataDir: string): Promise<Db> {
  return databaseUrl ? openPostgres(databaseUrl) : openPglite(path.join(dataDir, 'pglite'));
}

function openPostgres(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  // An idle connection dropping (say, Postgres restarting) shouldn't crash the server.
  pool.on('error', (error) => console.error('[db] idle connection error:', error.message));
  return {
    kind: 'postgres',
    async query(sql, params) {
      return (await pool.query(sql, params)).rows;
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async (sql, params) => (await client.query(sql, params)).rows,
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dir: string): Promise<Db> {
  const db = new PGlite(dir, { parsers: { [pgliteTypes.INT8]: (value: string) => Number(value) } });
  await db.waitReady;
  return {
    kind: 'pglite',
    async query(sql, params) {
      return (await db.query(sql, params)).rows as never;
    },
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({ query: async (sql, params) => (await tx.query(sql, params)).rows as never }),
      ),
    close: () => db.close(),
  };
}

/** Postgres error code for a UNIQUE (or primary key) violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '23505';
}

// Schema changes, in order. Never edit one that has shipped; add a new one instead.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    handle TEXT UNIQUE,
    created_at BIGINT NOT NULL,
    banned BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE TABLE login_codes (
    email TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    sent_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INT NOT NULL DEFAULT 0
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE days (
    date TEXT PRIMARY KEY,
    theme TEXT NOT NULL
  );
  CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL UNIQUE,
    user_id BIGINT NOT NULL REFERENCES users(id),
    day TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live'
      CHECK (status IN ('live', 'hidden', 'deleted', 'removed')),
    reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (user_id, day)
  );
  CREATE INDEX posts_day ON posts(day, status);
  CREATE TABLE likes (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE INDEX likes_user ON likes(user_id);
  CREATE TABLE reports (
    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  `,
  // Names can have capitals now, but "Fern" and "fern" still can't both exist.
  `
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_handle_key;
  CREATE UNIQUE INDEX users_handle_lower ON users (LOWER(handle));
  `,
];

/** Brings the schema up to date. Safe to run on every start. */
export async function migrate(db: Db): Promise<void> {
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at BIGINT NOT NULL)',
  );
  await db.transaction(async (tx) => {
    // Only one server process migrates at a time.
    await tx.query('SELECT pg_advisory_xact_lock(7461)');
    const done = new Set(
      (await tx.query<{ version: number }>('SELECT version FROM schema_migrations')).map(
        (r) => r.version,
      ),
    );
    for (const [i, sql] of MIGRATIONS.entries()) {
      const version = i + 1;
      if (done.has(version)) continue;
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        await tx.query(statement);
      }
      await tx.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [
        version,
        Date.now(),
      ]);
    }
  });
}
