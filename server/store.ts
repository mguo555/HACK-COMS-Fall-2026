// The SQLite database (node:sqlite, built into Node 22). One file: <dataDir>/stalk.db.
//
// The one-photo-a-day rule lives in the schema: posts has UNIQUE (user_id, day), and a deleted
// post keeps its row, so deleting doesn't free up the day.
import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { PostStatus } from '../src/app/shared/protocol';

export interface UserRow {
  id: number;
  email: string;
  handle: string | null;
  created_at: number;
  banned: number;
}

export interface CodeRow {
  email: string;
  salt: string;
  hash: string;
  sent_at: number;
  expires_at: number;
  attempts: number;
}

export interface PostRow {
  id: string;
  userId: number;
  handle: string;
  day: string;
  width: number;
  height: number;
  createdAt: number;
  status: PostStatus;
  reviewed: number;
  likes: number;
  liked: number;
}

export interface DaySummaryRow {
  date: string;
  theme: string;
  posts: number;
  cover: string | null;
}

export interface ModRow extends PostRow {
  email: string;
  banned: number;
  theme: string | null;
  reports: number;
}

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  handle TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  banned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  hash TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE days (
  date TEXT PRIMARY KEY,
  theme TEXT NOT NULL
);
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  reviewed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, day)
);
CREATE INDEX posts_day ON posts(day, status);
CREATE TABLE likes (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX likes_user ON likes(user_id);
CREATE TABLE reports (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
`;

// Shared SELECT for anything that lists posts. The one parameter is the viewer's user id (or -1).
const POST_COLUMNS = `
  p.id, p.user_id AS userId, u.handle, p.day, p.width, p.height, p.created_at AS createdAt,
  p.status, p.reviewed,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
  EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
`;

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;',
    );
    const { user_version } = this.get<{ user_version: number }>('PRAGMA user_version')!;
    if (user_version === 0) {
      this.transaction(() => {
        this.db.exec(SCHEMA);
        this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    }
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // Users

  userById(id: number): UserRow | undefined {
    return this.get('SELECT * FROM users WHERE id = ?', id);
  }

  userByEmail(email: string): UserRow | undefined {
    return this.get('SELECT * FROM users WHERE email = ?', email);
  }

  userByHandle(handle: string): UserRow | undefined {
    return this.get('SELECT * FROM users WHERE handle = ?', handle);
  }

  createUser(email: string, now: number): UserRow {
    this.run('INSERT INTO users (email, created_at) VALUES (?, ?)', email, now);
    return this.userByEmail(email)!;
  }

  /** False if someone else already has the handle. */
  setHandle(userId: number, handle: string): boolean {
    try {
      this.run('UPDATE users SET handle = ? WHERE id = ?', handle, userId);
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /** Bans the user, signs them out everywhere, and returns the ids of posts that came down. */
  banUser(userId: number): string[] {
    return this.transaction(() => {
      this.run('UPDATE users SET banned = 1 WHERE id = ?', userId);
      this.run('DELETE FROM sessions WHERE user_id = ?', userId);
      const ids = this.all<{ id: string }>(
        "SELECT id FROM posts WHERE user_id = ? AND status IN ('live', 'hidden')",
        userId,
      ).map((r) => r.id);
      this.run(
        "UPDATE posts SET status = 'removed' WHERE user_id = ? AND status IN ('live', 'hidden')",
        userId,
      );
      return ids;
    });
  }

  // Sign-in codes

  getCode(email: string): CodeRow | undefined {
    return this.get('SELECT * FROM login_codes WHERE email = ?', email);
  }

  saveCode(code: Omit<CodeRow, 'attempts'>): void {
    this.run(
      `INSERT OR REPLACE INTO login_codes (email, salt, hash, sent_at, expires_at, attempts)
       VALUES (?, ?, ?, ?, ?, 0)`,
      code.email,
      code.salt,
      code.hash,
      code.sent_at,
      code.expires_at,
    );
  }

  countCodeAttempt(email: string): void {
    this.run('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?', email);
  }

  deleteCode(email: string): void {
    this.run('DELETE FROM login_codes WHERE email = ?', email);
  }

  // Sessions

  createSession(tokenHash: string, userId: number, now: number, expiresAt: number): void {
    this.run(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      tokenHash,
      userId,
      now,
      expiresAt,
    );
  }

  sessionUser(tokenHash: string, now: number): UserRow | undefined {
    return this.get(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
      tokenHash,
      now,
    );
  }

  deleteSession(tokenHash: string): void {
    this.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  pruneExpired(now: number): void {
    this.run('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.run('DELETE FROM login_codes WHERE expires_at <= ?', now);
  }

  // Days

  dayTheme(date: string): string | undefined {
    return this.get<{ theme: string }>('SELECT theme FROM days WHERE date = ?', date)?.theme;
  }

  /** Saves the day's theme the first time the day is seen, then always returns the saved one. */
  openDay(date: string, theme: string): string {
    this.run('INSERT OR IGNORE INTO days (date, theme) VALUES (?, ?)', date, theme);
    return this.dayTheme(date)!;
  }

  pastDays(before: string, limit: number): DaySummaryRow[] {
    return this.all(
      `SELECT d.date, d.theme,
         (SELECT COUNT(*) FROM posts p WHERE p.day = d.date AND p.status = 'live') AS posts,
         (SELECT p.id FROM posts p LEFT JOIN likes l ON l.post_id = p.id
            WHERE p.day = d.date AND p.status = 'live'
            GROUP BY p.id ORDER BY COUNT(l.user_id) DESC, p.created_at ASC LIMIT 1) AS cover
       FROM days d WHERE d.date < ? ORDER BY d.date DESC LIMIT ?`,
      before,
      limit,
    );
  }

  // Posts

  insertPost(post: {
    id: string;
    userId: number;
    day: string;
    width: number;
    height: number;
    now: number;
  }): boolean {
    try {
      this.run(
        'INSERT INTO posts (id, user_id, day, created_at, width, height) VALUES (?, ?, ?, ?, ?, ?)',
        post.id,
        post.userId,
        post.day,
        post.now,
        post.width,
        post.height,
      );
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  post(id: string, viewerId = -1): PostRow | undefined {
    return this.get(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?`,
      viewerId,
      id,
    );
  }

  postFor(userId: number, day: string, viewerId = -1): PostRow | undefined {
    return this.get(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ? AND p.day = ?`,
      viewerId,
      userId,
      day,
    );
  }

  /** The live posts for a day, newest first. */
  board(day: string, viewerId = -1): PostRow[] {
    return this.all(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.day = ? AND p.status = 'live' ORDER BY p.created_at DESC, p.rowid DESC`,
      viewerId,
      day,
    );
  }

  /** A user's posts, newest first: live ones, plus hidden ones if `includeHidden`. */
  postsBy(userId: number, viewerId: number, includeHidden: boolean): PostRow[] {
    return this.all(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = ? AND (p.status = 'live' OR (? AND p.status = 'hidden'))
       ORDER BY p.day DESC`,
      viewerId,
      userId,
      includeHidden ? 1 : 0,
    );
  }

  /** Every day the user posted (deleted posts count, mod-removed ones don't), newest first. */
  postedDays(userId: number): string[] {
    return this.all<{ day: string }>(
      "SELECT day FROM posts WHERE user_id = ? AND status != 'removed' ORDER BY day DESC",
      userId,
    ).map((r) => r.day);
  }

  setStatus(id: string, status: PostStatus, reviewed?: boolean): void {
    if (reviewed === undefined) {
      this.run('UPDATE posts SET status = ? WHERE id = ?', status, id);
    } else {
      this.run('UPDATE posts SET status = ?, reviewed = ? WHERE id = ?', status, +reviewed, id);
    }
  }

  // Likes and reports

  setLike(postId: string, userId: number, liked: boolean, now: number): number {
    if (liked) {
      this.run(
        'INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)',
        postId,
        userId,
        now,
      );
    } else {
      this.run('DELETE FROM likes WHERE post_id = ? AND user_id = ?', postId, userId);
    }
    return this.get<{ n: number }>('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', postId)!.n;
  }

  /** Adds a report (once per person) and returns how many the post has. */
  report(postId: string, userId: number, now: number): number {
    this.run(
      'INSERT OR IGNORE INTO reports (post_id, user_id, created_at) VALUES (?, ?, ?)',
      postId,
      userId,
      now,
    );
    return this.get<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE post_id = ?', postId)!
      .n;
  }

  /** Reported posts nobody has reviewed yet, hidden ones first. */
  modQueue(): ModRow[] {
    return this.all(
      `SELECT ${POST_COLUMNS}, u.email, u.banned, d.theme,
         (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id) AS reports
       FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN days d ON d.date = p.day
       WHERE p.status IN ('live', 'hidden') AND p.reviewed = 0
         AND EXISTS (SELECT 1 FROM reports r WHERE r.post_id = p.id)
       ORDER BY p.status = 'hidden' DESC, reports DESC, p.created_at DESC LIMIT 200`,
      -1,
    );
  }

  // Helpers

  private get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}
