// Tests run on PGlite by default. Set TEST_DATABASE_URL to a Postgres server to run them there
// instead; each test file then gets its own fresh database.
import pg from 'pg';

export async function testDatabaseUrl(): Promise<string | undefined> {
  const base = process.env['TEST_DATABASE_URL'];
  if (!base) return undefined;
  const name = `stalk_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const client = new pg.Client({ connectionString: base });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}
