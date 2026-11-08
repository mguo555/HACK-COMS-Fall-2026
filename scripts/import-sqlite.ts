// One-time move from the old SQLite database (before Postgres) into Postgres.
//
//   DATABASE_URL=postgres://... tsx scripts/import-sqlite.ts /data/stalk.db
//
// scripts/deploy.sh runs this by itself on the first deploy that finds an old stalk.db. It
// refuses to run if Postgres already has accounts, so it can't import twice.
import '../server/env.mjs';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openDb } from '../server/db';

type Row = Record<string, unknown>;

async function main(): Promise<void> {
  const file = process.argv[2];
  const url = process.env['DATABASE_URL'];
  if (!file || !url) {
    console.error(
      'usage: DATABASE_URL=postgres://... tsx scripts/import-sqlite.ts path/to/stalk.db',
    );
    process.exit(1);
  }

  const sqlite = new DatabaseSync(file, { readOnly: true });
  const all = (sql: string) => sqlite.prepare(sql).all() as Row[];
  const db = await openDb(url, '');
  await migrate(db);

  const [{ n }] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM users');
  if (n > 0) {
    console.error(`Postgres already has ${n} accounts. Not importing again.`);
    process.exit(1);
  }

  const counts = await db.transaction(async (tx) => {
    const users = all('SELECT * FROM users ORDER BY id');
    for (const u of users) {
      await tx.query(
        'INSERT INTO users (id, email, handle, created_at, banned) VALUES ($1, $2, $3, $4, $5)',
        [u['id'], u['email'], u['handle'], u['created_at'], !!u['banned']],
      );
    }
    // New accounts continue after the highest imported id.
    await tx.query(
      "SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT MAX(id) FROM users), 1))",
    );

    const sessions = all('SELECT * FROM sessions');
    for (const s of sessions) {
      await tx.query(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
        [s['token_hash'], s['user_id'], s['created_at'], s['expires_at']],
      );
    }

    const days = all('SELECT * FROM days');
    for (const d of days) {
      await tx.query('INSERT INTO days (date, theme) VALUES ($1, $2)', [d['date'], d['theme']]);
    }

    // Oldest first, so the new seq column keeps the original order.
    const posts = all('SELECT * FROM posts ORDER BY created_at, rowid');
    for (const p of posts) {
      await tx.query(
        `INSERT INTO posts (id, user_id, day, created_at, width, height, status, reviewed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          p['id'],
          p['user_id'],
          p['day'],
          p['created_at'],
          p['width'],
          p['height'],
          p['status'],
          !!p['reviewed'],
        ],
      );
    }

    const likes = all('SELECT * FROM likes');
    for (const l of likes) {
      await tx.query('INSERT INTO likes (post_id, user_id, created_at) VALUES ($1, $2, $3)', [
        l['post_id'],
        l['user_id'],
        l['created_at'],
      ]);
    }

    const reports = all('SELECT * FROM reports');
    for (const r of reports) {
      await tx.query('INSERT INTO reports (post_id, user_id, created_at) VALUES ($1, $2, $3)', [
        r['post_id'],
        r['user_id'],
        r['created_at'],
      ]);
    }

    return {
      users: users.length,
      sessions: sessions.length,
      days: days.length,
      posts: posts.length,
      likes: likes.length,
      reports: reports.length,
    };
  });

  await db.close();
  sqlite.close();
  console.log(
    'Imported:',
    Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(', '),
  );
}

main().catch((error) => {
  console.error('Import failed, nothing was changed in Postgres:', error);
  process.exit(1);
});
