// Every query the app runs, on Postgres (see db.ts for the connection and the schema).
//
// The one-photo-a-day rule lives in the schema: posts has UNIQUE (user_id, day), and a deleted
// post keeps its row, so deleting doesn't free up the day.
import type { PostStatus } from '../src/app/shared/protocol';
import { Db, isUniqueViolation } from './db';

export interface UserRow {
  id: number;
  email: string;
  handle: string | null;
  created_at: number;
  banned: boolean;
}

export interface SessionUserRow extends UserRow {
  session_expires_at: number;
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
  reviewed: boolean;
  likes: number;
  liked: boolean;
}

export interface DaySummaryRow {
  date: string;
  theme: string;
  posts: number;
  cover: string | null;
}

export interface ModRow extends PostRow {
  email: string;
  banned: boolean;
  theme: string | null;
  reports: number;
}

// Shared SELECT for anything that lists posts. $1 is always the viewer's user id (or -1).
// Postgres folds unquoted names to lower case, hence the quoted camelCase aliases.
const POST_COLUMNS = `
  p.id, p.user_id AS "userId", u.handle, p.day, p.width, p.height, p.created_at AS "createdAt",
  p.status, p.reviewed,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
  EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = $1) AS liked
`;

export class Store {
  constructor(readonly db: Db) {}

  private async one<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.db.query<T>(sql, params))[0];
  }

  // Users

  userById(id: number): Promise<UserRow | undefined> {
    return this.one('SELECT * FROM users WHERE id = $1', [id]);
  }

  userByEmail(email: string): Promise<UserRow | undefined> {
    return this.one('SELECT * FROM users WHERE email = $1', [email]);
  }

  userByHandle(handle: string): Promise<UserRow | undefined> {
    return this.one('SELECT * FROM users WHERE handle = $1', [handle]);
  }

  /** Finds or creates the account for an email (two people can't race into two accounts). */
  async findOrCreateUser(email: string, now: number): Promise<UserRow> {
    await this.db.query(
      'INSERT INTO users (email, created_at) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
      [email, now],
    );
    return (await this.userByEmail(email))!;
  }

  /** False if someone else already has the handle. */
  async setHandle(userId: number, handle: string): Promise<boolean> {
    try {
      await this.db.query('UPDATE users SET handle = $1 WHERE id = $2', [handle, userId]);
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /** Bans the user, signs them out everywhere, and returns the ids of posts that came down. */
  banUser(userId: number): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      await tx.query('UPDATE users SET banned = TRUE WHERE id = $1', [userId]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      const rows = await tx.query<{ id: string }>(
        `UPDATE posts SET status = 'removed'
         WHERE user_id = $1 AND status IN ('live', 'hidden') RETURNING id`,
        [userId],
      );
      return rows.map((r) => r.id);
    });
  }

  // Sign-in codes

  getCode(email: string): Promise<CodeRow | undefined> {
    return this.one('SELECT * FROM login_codes WHERE email = $1', [email]);
  }

  async saveCode(code: Omit<CodeRow, 'attempts'>): Promise<void> {
    await this.db.query(
      `INSERT INTO login_codes (email, salt, hash, sent_at, expires_at, attempts)
       VALUES ($1, $2, $3, $4, $5, 0)
       ON CONFLICT (email) DO UPDATE SET salt = EXCLUDED.salt, hash = EXCLUDED.hash,
         sent_at = EXCLUDED.sent_at, expires_at = EXCLUDED.expires_at, attempts = 0`,
      [code.email, code.salt, code.hash, code.sent_at, code.expires_at],
    );
  }

  async countCodeAttempt(email: string): Promise<void> {
    await this.db.query('UPDATE login_codes SET attempts = attempts + 1 WHERE email = $1', [email]);
  }

  async deleteCode(email: string): Promise<void> {
    await this.db.query('DELETE FROM login_codes WHERE email = $1', [email]);
  }

  // Sessions

  async createSession(
    tokenHash: string,
    userId: number,
    now: number,
    expiresAt: number,
  ): Promise<void> {
    await this.db.query(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)',
      [tokenHash, userId, now, expiresAt],
    );
  }

  sessionUser(tokenHash: string, now: number): Promise<SessionUserRow | undefined> {
    return this.one(
      `SELECT u.*, s.expires_at AS session_expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`,
      [tokenHash, now],
    );
  }

  async extendSession(tokenHash: string, expiresAt: number): Promise<void> {
    await this.db.query('UPDATE sessions SET expires_at = $1 WHERE token_hash = $2', [
      expiresAt,
      tokenHash,
    ]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async pruneExpired(now: number): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
    await this.db.query('DELETE FROM login_codes WHERE expires_at <= $1', [now]);
  }

  // Days

  async dayTheme(date: string): Promise<string | undefined> {
    return (await this.one<{ theme: string }>('SELECT theme FROM days WHERE date = $1', [date]))
      ?.theme;
  }

  /** Saves the day's theme the first time the day is seen, then always returns the saved one. */
  async openDay(date: string, theme: string): Promise<string> {
    await this.db.query(
      'INSERT INTO days (date, theme) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING',
      [date, theme],
    );
    return (await this.dayTheme(date))!;
  }

  pastDays(before: string, limit: number): Promise<DaySummaryRow[]> {
    return this.db.query(
      `SELECT d.date, d.theme,
         (SELECT COUNT(*) FROM posts p WHERE p.day = d.date AND p.status = 'live') AS posts,
         (SELECT p.id FROM posts p LEFT JOIN likes l ON l.post_id = p.id
            WHERE p.day = d.date AND p.status = 'live'
            GROUP BY p.id ORDER BY COUNT(l.user_id) DESC, p.created_at ASC LIMIT 1) AS cover
       FROM days d WHERE d.date < $1 ORDER BY d.date DESC LIMIT $2`,
      [before, limit],
    );
  }

  // Posts

  async insertPost(post: {
    id: string;
    userId: number;
    day: string;
    width: number;
    height: number;
    now: number;
  }): Promise<boolean> {
    try {
      await this.db.query(
        `INSERT INTO posts (id, user_id, day, created_at, width, height)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [post.id, post.userId, post.day, post.now, post.width, post.height],
      );
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  post(id: string, viewerId = -1): Promise<PostRow | undefined> {
    return this.one(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = $2`,
      [viewerId, id],
    );
  }

  postFor(userId: number, day: string, viewerId = -1): Promise<PostRow | undefined> {
    return this.one(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $2 AND p.day = $3`,
      [viewerId, userId, day],
    );
  }

  /** The live posts for a day, newest first. */
  board(day: string, viewerId = -1): Promise<PostRow[]> {
    return this.db.query(
      `SELECT ${POST_COLUMNS} FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.day = $2 AND p.status = 'live' ORDER BY p.created_at DESC, p.seq DESC`,
      [viewerId, day],
    );
  }

  /** A user's posts with each day's theme, newest first: live ones, plus hidden if asked. */
  postsBy(
    userId: number,
    viewerId: number,
    includeHidden: boolean,
  ): Promise<(PostRow & { theme: string | null })[]> {
    return this.db.query(
      `SELECT ${POST_COLUMNS}, d.theme
       FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN days d ON d.date = p.day
       WHERE p.user_id = $2 AND (p.status = 'live' OR ($3 AND p.status = 'hidden'))
       ORDER BY p.day DESC`,
      [viewerId, userId, includeHidden],
    );
  }

  /** Every post the user ever made (one per day), newest first, whatever its status. */
  history(userId: number): Promise<{ id: string; day: string; status: PostStatus }[]> {
    return this.db.query('SELECT id, day, status FROM posts WHERE user_id = $1 ORDER BY day DESC', [
      userId,
    ]);
  }

  async setStatus(id: string, status: PostStatus, reviewed?: boolean): Promise<void> {
    if (reviewed === undefined) {
      await this.db.query('UPDATE posts SET status = $1 WHERE id = $2', [status, id]);
    } else {
      await this.db.query('UPDATE posts SET status = $1, reviewed = $2 WHERE id = $3', [
        status,
        reviewed,
        id,
      ]);
    }
  }

  // Likes and reports

  async setLike(postId: string, userId: number, liked: boolean, now: number): Promise<number> {
    if (liked) {
      await this.db.query(
        `INSERT INTO likes (post_id, user_id, created_at) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [postId, userId, now],
      );
    } else {
      await this.db.query('DELETE FROM likes WHERE post_id = $1 AND user_id = $2', [
        postId,
        userId,
      ]);
    }
    return (await this.one<{ n: number }>('SELECT COUNT(*) AS n FROM likes WHERE post_id = $1', [
      postId,
    ]))!.n;
  }

  /** Adds a report (once per person) and returns how many the post has. */
  async report(postId: string, userId: number, now: number): Promise<number> {
    await this.db.query(
      `INSERT INTO reports (post_id, user_id, created_at) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [postId, userId, now],
    );
    return (await this.one<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE post_id = $1', [
      postId,
    ]))!.n;
  }

  /** Reported posts nobody has reviewed yet, hidden ones first. */
  modQueue(): Promise<ModRow[]> {
    return this.db.query(
      `SELECT ${POST_COLUMNS}, u.email, u.banned, d.theme,
         (SELECT COUNT(*) FROM reports r WHERE r.post_id = p.id) AS reports
       FROM posts p JOIN users u ON u.id = p.user_id LEFT JOIN days d ON d.date = p.day
       WHERE p.status IN ('live', 'hidden') AND NOT p.reviewed
         AND EXISTS (SELECT 1 FROM reports r WHERE r.post_id = p.id)
       ORDER BY (p.status = 'hidden') DESC, reports DESC, p.created_at DESC LIMIT 200`,
      [-1],
    );
  }
}
