// The API. Every route is listed in the table in createApp; shapes are in
// src/app/shared/protocol.ts.
//
//   GET  /api/session                   who you are, today's theme, when the next one starts
//   POST /api/auth/code      {email}    email a sign-in code
//   POST /api/auth/verify    {email, code}  sign in (sets the session cookie)
//   POST /api/auth/handle    {handle}   pick the name shown under your photos
//   POST /api/auth/sign-out
//   GET  /api/days                      today, the next 7 themes, and past days
//   GET  /api/days/:date|today          one day's board
//   POST /api/posts          image body today's photo (Content-Type image/*)
//   POST /api/posts/:id/like {liked}
//   POST /api/posts/:id/report
//   POST /api/posts/:id/delete          your own photo (the day stays used)
//   GET  /api/users/:handle             profile and past photos
//   GET  /api/img/:id/full|thumb        the image files
//   GET  /api/mod/queue                 admins: reported photos
//   POST /api/mod/posts/:id  {action}   admins: 'keep' or 'remove'
//   POST /api/mod/users/:handle/ban     admins
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { addDays, dayKey, isDayKey, startOfDay, streakLength } from '../src/app/shared/days';
import type {
  Board,
  CalendarDay,
  DayInfo,
  Me,
  ModQueue,
  MyPost,
  Post,
  Profile,
  SessionInfo,
  ThemeList,
} from '../src/app/shared/protocol';
import { handleProblem, normalizeHandle } from '../src/app/shared/rules';
import { themeFor } from '../src/app/shared/themes';
import { Auth } from './auth';
import type { Config } from './config';
import { migrate, openDb } from './db';
import {
  HttpError,
  RateLimiter,
  clientIp,
  readBody,
  readJson,
  sendJson,
  serveStatic,
} from './http';
import { POST_ID, deleteImage, imageFile, newPostId, processImage, saveImage } from './images';
import { Mailer, createMailer } from './mail';
import { PostRow, Store, UserRow } from './store';

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: string[];
  body: Record<string, unknown>;
  user: UserRow | null;
  now: number;
  ip: string;
}

interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  handler: (ctx: Ctx) => unknown;
  /** The handler reads the body itself (photo uploads). */
  raw?: boolean;
}

export interface App {
  server: http.Server;
  store: Store;
  /** 'postgres' or 'pglite'. */
  database: string;
  mailer: Mailer;
  close(): Promise<void>;
}

/** Returned by handlers that already wrote the response. */
const HANDLED = Symbol('handled');
const ID = '([A-Za-z0-9_-]{12})';
const HANDLE = '([A-Za-z0-9_]{1,40})';
const MAX_PROCESSING = 3;

export async function createApp(
  config: Config,
  options: { now?: () => number; logMail?: boolean } = {},
): Promise<App> {
  const clock = options.now ?? Date.now;
  mkdirSync(config.dataDir, { recursive: true });
  const db = await openDb(config.databaseUrl, config.dataDir);
  await migrate(db);
  const store = new Store(db);
  const mailer = createMailer(config, options.logMail ?? true);
  const auth = new Auth(config, store, mailer);
  const limiter = new RateLimiter();
  const tz = config.timeZone;
  const publicUrl = config.publicUrl ? new URL(config.publicUrl) : null;
  const allowedOrigin = publicUrl?.origin ?? null;
  let processing = 0;

  // Access

  function viewer(c: Ctx): void {
    if (config.membersOnly && !c.user) {
      throw new HttpError(401, 'Sign in with your RIT email to see the photos.');
    }
  }

  function signedIn(c: Ctx): UserRow {
    if (!c.user) throw new HttpError(401, 'Sign in first.');
    return c.user;
  }

  function member(c: Ctx): UserRow & { handle: string } {
    const user = signedIn(c);
    if (!user.handle) throw new HttpError(403, 'Pick a name first.');
    return user as UserRow & { handle: string };
  }

  function admin(c: Ctx): UserRow {
    const user = signedIn(c);
    if (!auth.isAdmin(user)) throw new HttpError(403, 'Mods only.');
    return user;
  }

  // Shapes

  function me(user: UserRow): Me {
    return { handle: user.handle, email: user.email, isAdmin: auth.isAdmin(user) };
  }

  function toPost(row: PostRow, viewerId: number): Post {
    return {
      id: row.id,
      day: row.day,
      handle: row.handle,
      width: row.width,
      height: row.height,
      likes: row.likes,
      liked: !!row.liked,
      mine: row.userId === viewerId,
      createdAt: row.createdAt,
    };
  }

  function toMyPost(row: PostRow, viewerId: number): MyPost {
    return { ...toPost(row, viewerId), status: row.status };
  }

  /** Today's date and theme. The theme is saved the first time a day is seen. */
  async function openToday(now: number): Promise<DayInfo> {
    const date = dayKey(now, tz);
    return { date, theme: await store.openDay(date, themeFor(date)) };
  }

  async function livePost(id: string, viewerId: number): Promise<PostRow> {
    const post = await store.post(id, viewerId);
    if (!post || post.status !== 'live') throw new HttpError(404, 'That photo is gone.');
    return post;
  }

  // Handlers

  async function session(c: Ctx): Promise<SessionInfo> {
    const today = await openToday(c.now);
    return {
      user: c.user ? me(c.user) : null,
      today,
      nextDayAt: startOfDay(addDays(today.date, 1), tz),
      membersOnly: config.membersOnly,
    };
  }

  async function requestCode(c: Ctx) {
    return { ok: true, resendIn: await auth.requestCode(c.body['email'], c.ip, c.now) };
  }

  async function verify(c: Ctx) {
    const { user, token } = await auth.verifyCode(c.body['email'], c.body['code'], c.ip, c.now);
    c.res.setHeader('Set-Cookie', auth.sessionCookie(token));
    return { user: me(user) };
  }

  async function setHandle(c: Ctx) {
    const user = signedIn(c);
    const handle = normalizeHandle(String(c.body['handle'] ?? ''));
    const problem = handleProblem(handle);
    if (problem) throw new HttpError(400, problem);
    if (user.handle === handle) return { user: me(user) };
    // Checked before the daily limit, so trying a taken name doesn't use up a change.
    const owner = await store.userByHandle(handle);
    if (owner && owner.id !== user.id) throw new HttpError(409, 'That name is taken.');
    if (!limiter.take(`handle:${user.id}`, 3, 86_400_000, c.now)) {
      throw new HttpError(429, 'You changed your name a lot today. Try again tomorrow.');
    }
    if (!(await store.setHandle(user.id, handle))) throw new HttpError(409, 'That name is taken.');
    return { user: me((await store.userById(user.id))!) };
  }

  async function signOut(c: Ctx) {
    await auth.signOut(c.req);
    c.res.setHeader('Set-Cookie', auth.sessionCookie(null));
    return { ok: true };
  }

  async function themes(c: Ctx): Promise<ThemeList> {
    viewer(c);
    const today = await openToday(c.now);
    const upcoming = [1, 2, 3, 4, 5, 6, 7].map((i) => {
      const date = addDays(today.date, i);
      return { date, theme: themeFor(date) };
    });
    return { today, upcoming, past: await store.pastDays(today.date, 120) };
  }

  async function board(c: Ctx): Promise<Board> {
    viewer(c);
    const today = await openToday(c.now);
    const date = c.params[0] === 'today' ? today.date : c.params[0];
    if (!isDayKey(date) || date > today.date) {
      throw new HttpError(404, "That day hasn't happened yet.");
    }
    const theme = date === today.date ? today.theme : await store.dayTheme(date);
    if (!theme) throw new HttpError(404, 'Nobody posted that day.');
    const uid = c.user?.id ?? -1;
    const mine = c.user ? await store.postFor(c.user.id, date, uid) : undefined;
    return {
      day: { date, theme },
      isToday: date === today.date,
      posts: (await store.board(date, uid)).map((row) => toPost(row, uid)),
      mine: mine ? toMyPost(mine, uid) : null,
    };
  }

  async function upload(c: Ctx) {
    const user = member(c);
    const today = await openToday(c.now);
    const claimed = c.req.headers['x-day'];
    if (typeof claimed === 'string' && claimed !== today.date) {
      throw new HttpError(409, 'A new day just started. Check out the new theme first.');
    }
    if (await store.postFor(user.id, today.date)) {
      throw new HttpError(409, 'You already posted today. New theme at midnight.');
    }
    const type = String(c.req.headers['content-type'] ?? '');
    if (type.startsWith('video/')) {
      throw new HttpError(415, 'Videos aren’t allowed. Still photos only.');
    }
    if (!type.startsWith('image/')) throw new HttpError(415, 'Only photos can be posted.');
    if (processing >= MAX_PROCESSING) {
      throw new HttpError(503, 'Lots of photos coming in right now. Try again in a few seconds.');
    }

    processing++;
    try {
      const mb = Math.round(config.maxUploadBytes / 1024 / 1024);
      const body = await readBody(
        c.req,
        config.maxUploadBytes,
        `That photo is too big. The limit is ${mb} MB.`,
      );
      const image = await processImage(body);
      const id = newPostId();
      await saveImage(config.dataDir, id, image);
      const saved = await store.insertPost({
        id,
        userId: user.id,
        day: today.date,
        width: image.width,
        height: image.height,
        now: c.now,
      });
      if (!saved) {
        // Another upload from the same person won the race.
        await deleteImage(config.dataDir, id);
        throw new HttpError(409, 'You already posted today. New theme at midnight.');
      }
      return { post: toMyPost((await store.post(id, user.id))!, user.id) };
    } finally {
      processing--;
    }
  }

  async function like(c: Ctx) {
    const user = member(c);
    const post = await livePost(c.params[0], user.id);
    if (post.userId === user.id) throw new HttpError(400, 'You can’t like your own photo.');
    if (!limiter.take(`like:${user.id}`, 600, 3_600_000, c.now)) {
      throw new HttpError(429, 'Slow down a little.');
    }
    const liked = c.body['liked'] !== false;
    return { likes: await store.setLike(post.id, user.id, liked, c.now), liked };
  }

  async function report(c: Ctx) {
    const user = member(c);
    const post = await store.post(c.params[0]);
    if (!post || (post.status !== 'live' && post.status !== 'hidden')) {
      throw new HttpError(404, 'That photo is gone.');
    }
    if (post.userId === user.id) throw new HttpError(400, 'That’s yours. You can delete it.');
    const reports = await store.report(post.id, user.id, c.now);
    if (post.status === 'live' && !post.reviewed && reports >= config.reportsToHide) {
      await store.setStatus(post.id, 'hidden');
    }
    return { ok: true };
  }

  async function deletePost(c: Ctx) {
    const user = signedIn(c);
    const post = await store.post(c.params[0]);
    if (!post || post.userId !== user.id || (post.status !== 'live' && post.status !== 'hidden')) {
      throw new HttpError(404, 'That photo is gone.');
    }
    await store.setStatus(post.id, 'deleted');
    await deleteImage(config.dataDir, post.id);
    return { ok: true };
  }

  async function profile(c: Ctx): Promise<Profile> {
    viewer(c);
    const target = await store.userByHandle(normalizeHandle(c.params[0]));
    if (!target?.handle || target.banned) {
      throw new HttpError(404, 'Nobody here goes by that name.');
    }
    const uid = c.user?.id ?? -1;
    const isMe = uid === target.id;
    const posts = (await store.postsBy(target.id, uid, isMe)).map((row) => ({
      ...toMyPost(row, uid),
      theme: row.theme ?? themeFor(row.day),
    }));
    const history = await store.history(target.id);
    // Deleted days still count toward the streak; days a mod took down don't.
    const days = history.filter((h) => h.status !== 'removed').map((h) => h.day);
    // Everyone sees the days with a photo up. Deleted and taken-down days are only for the owner.
    const calendar = history.flatMap((h): CalendarDay[] => {
      if (h.status === 'live' || (isMe && h.status === 'hidden')) {
        return [{ day: h.day, status: 'posted', id: h.id }];
      }
      if (isMe && h.status !== 'hidden') return [{ day: h.day, status: h.status, id: null }];
      return [];
    });
    return {
      handle: target.handle,
      joinedAt: target.created_at,
      streak: streakLength(days, (await openToday(c.now)).date),
      days: days.length,
      likes: posts.reduce((sum, p) => sum + (p.status === 'live' ? p.likes : 0), 0),
      isMe,
      posts,
      calendar,
    };
  }

  async function image(c: Ctx) {
    const [id, kind] = c.params;
    const post = POST_ID.test(id) ? await store.post(id) : undefined;
    const user = c.user;
    const visible =
      post &&
      ((post.status === 'live' && (!config.membersOnly || user)) ||
        (post.status === 'hidden' && user && (user.id === post.userId || auth.isAdmin(user))));
    if (!visible) throw new HttpError(404, 'Not found.');
    const data = await readFile(imageFile(config.dataDir, id, kind as 'full' | 'thumb')).catch(
      () => null,
    );
    if (!data) throw new HttpError(404, 'Not found.');
    c.res.writeHead(200, {
      'Content-Type': 'image/webp',
      'Content-Length': data.length,
      'Cache-Control': `${config.membersOnly ? 'private' : 'public'}, max-age=3600`,
      'X-Content-Type-Options': 'nosniff',
    });
    c.res.end(data);
    return HANDLED;
  }

  async function modQueue(c: Ctx): Promise<ModQueue> {
    admin(c);
    return {
      items: (await store.modQueue()).map((row) => ({
        post: toMyPost(row, -1),
        theme: row.theme ?? themeFor(row.day),
        email: row.email,
        reports: row.reports,
        banned: !!row.banned,
      })),
    };
  }

  async function moderate(c: Ctx) {
    admin(c);
    const post = await store.post(c.params[0]);
    if (!post || (post.status !== 'live' && post.status !== 'hidden')) {
      throw new HttpError(404, 'That photo is gone.');
    }
    const action = c.body['action'];
    if (action === 'keep') {
      await store.setStatus(post.id, 'live', true);
    } else if (action === 'remove') {
      await store.setStatus(post.id, 'removed', true);
      await deleteImage(config.dataDir, post.id);
    } else {
      throw new HttpError(400, "Action must be 'keep' or 'remove'.");
    }
    return { ok: true };
  }

  async function ban(c: Ctx) {
    admin(c);
    const target = await store.userByHandle(normalizeHandle(c.params[0]));
    if (!target) throw new HttpError(404, 'Nobody here goes by that name.');
    if (auth.isAdmin(target)) throw new HttpError(400, 'Mods can’t be banned here.');
    const removed = await store.banUser(target.id);
    await Promise.all(removed.map((id) => deleteImage(config.dataDir, id)));
    return { ok: true, removed: removed.length };
  }

  const routes: Route[] = [
    { method: 'GET', pattern: /^\/api\/health$/, handler: () => ({ ok: true }) },
    { method: 'GET', pattern: /^\/api\/session$/, handler: session },
    { method: 'POST', pattern: /^\/api\/auth\/code$/, handler: requestCode },
    { method: 'POST', pattern: /^\/api\/auth\/verify$/, handler: verify },
    { method: 'POST', pattern: /^\/api\/auth\/handle$/, handler: setHandle },
    { method: 'POST', pattern: /^\/api\/auth\/sign-out$/, handler: signOut },
    { method: 'GET', pattern: /^\/api\/days$/, handler: themes },
    { method: 'GET', pattern: /^\/api\/days\/(today|\d{4}-\d{2}-\d{2})$/, handler: board },
    { method: 'POST', pattern: /^\/api\/posts$/, handler: upload, raw: true },
    { method: 'POST', pattern: new RegExp(`^/api/posts/${ID}/like$`), handler: like },
    { method: 'POST', pattern: new RegExp(`^/api/posts/${ID}/report$`), handler: report },
    { method: 'POST', pattern: new RegExp(`^/api/posts/${ID}/delete$`), handler: deletePost },
    { method: 'GET', pattern: new RegExp(`^/api/users/${HANDLE}$`), handler: profile },
    { method: 'GET', pattern: new RegExp(`^/api/img/${ID}/(full|thumb)$`), handler: image },
    { method: 'GET', pattern: /^\/api\/mod\/queue$/, handler: modQueue },
    { method: 'POST', pattern: new RegExp(`^/api/mod/posts/${ID}$`), handler: moderate },
    { method: 'POST', pattern: new RegExp(`^/api/mod/users/${HANDLE}/ban$`), handler: ban },
  ];

  /** Browsers send Origin on POSTs. Refuse ones from other sites (CSRF), on top of SameSite. */
  function checkOrigin(req: http.IncomingMessage): void {
    const origin = req.headers.origin;
    if (!origin) return;
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // Treated as a mismatch below.
    }
    if (host !== req.headers.host && origin !== allowedOrigin) {
      throw new HttpError(403, 'Requests from other sites aren’t allowed.');
    }
  }

  /**
   * Requests through Cloudflare should land on one address: https, without www. Session cookies
   * only work on the exact address that set them (and are https-only), so http:// or www. would
   * look like being signed out. Direct requests (health checks, Tailscale) are left alone.
   */
  function canonical(req: http.IncomingMessage, url: URL): string | null {
    if (!publicUrl || publicUrl.protocol !== 'https:' || !config.trustProxy) return null;
    const visitor = String(req.headers['cf-visitor'] ?? '');
    const proto =
      String(req.headers['x-forwarded-proto'] ?? '')
        .split(',')[0]
        .trim() ||
      (/"scheme":"(https?)"/.exec(visitor)?.[1] ?? '');
    if (!proto) return null;
    const wrongHost = req.headers.host === `www.${publicUrl.host}`;
    if (proto === 'https' && !wrongHost) return null;
    return publicUrl.origin + url.pathname + url.search;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    try {
      const target = canonical(req, url);
      if (target) {
        // 308 keeps POSTs as POSTs; GETs can use the classic 301.
        res.writeHead(method === 'GET' || method === 'HEAD' ? 301 : 308, { Location: target });
        return void res.end();
      }
      if (publicUrl?.protocol === 'https:' && config.trustProxy) {
        res.setHeader('Strict-Transport-Security', 'max-age=15552000');
      }
      if (!url.pathname.startsWith('/api/')) {
        if (config.staticDir && (method === 'GET' || method === 'HEAD')) {
          return await serveStatic(req, res, config.staticDir, url.pathname);
        }
        throw new HttpError(404, 'Not found.');
      }
      const route = routes.find((r) => r.method === method && r.pattern.test(url.pathname));
      if (!route) throw new HttpError(404, 'Not found.');

      const ctx: Ctx = {
        req,
        res,
        params: url.pathname.match(route.pattern)!.slice(1),
        body: {},
        user: null,
        now: clock(),
        ip: clientIp(req, config.trustProxy),
      };
      if (method === 'POST') {
        checkOrigin(req);
        if (!limiter.take(`post-ip:${ctx.ip}`, 300, 60_000, ctx.now)) {
          throw new HttpError(429, 'Slow down a little.');
        }
        if (!route.raw) {
          // A JSON content type forces a CORS preflight for cross-site requests.
          if (!req.headers['content-type']?.startsWith('application/json')) {
            throw new HttpError(415, 'Expected JSON.');
          }
          ctx.body = await readJson(req);
        }
      }
      ctx.user = await auth.userFrom(req, res, ctx.now);
      const result = await route.handler(ctx);
      if (result !== HANDLED) sendJson(res, 200, result);
    } catch (error) {
      const known = error instanceof HttpError;
      if (!known) console.error(`[server] ${method} ${url.pathname} failed:`, error);
      // If we're rejecting an upload early, drain it so the browser can read our answer.
      if (!req.complete && !req.destroyed) {
        res.setHeader('Connection', 'close');
        req.resume();
      }
      sendJson(res, known ? error.status : 500, {
        error: known ? error.message : 'Something went wrong on our end.',
      });
    }
  });

  const prune = () => {
    const now = clock();
    store.pruneExpired(now).catch((error) => console.error('[db] prune failed:', error));
    auth.limiter.prune(now);
    limiter.prune(now, 86_400_000);
  };
  const pruneTimer = setInterval(prune, 3_600_000);
  pruneTimer.unref();
  prune();

  return {
    server,
    store,
    mailer,
    database: db.kind,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(pruneTimer);
        server.close(() => {
          db.close().finally(resolve);
        });
        server.closeAllConnections();
      }),
  };
}
