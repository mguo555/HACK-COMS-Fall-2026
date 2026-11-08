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
import path from 'node:path';
import { addDays, dayKey, isDayKey, startOfDay, streakLength } from '../src/app/shared/days';
import type {
  Board,
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
  mailer: Mailer;
  close(): Promise<void>;
}

/** Returned by handlers that already wrote the response. */
const HANDLED = Symbol('handled');
const ID = '([A-Za-z0-9_-]{12})';
const HANDLE = '([A-Za-z0-9_]{1,40})';
const MAX_PROCESSING = 3;

export function createApp(
  config: Config,
  options: { now?: () => number; logMail?: boolean } = {},
): App {
  const clock = options.now ?? Date.now;
  mkdirSync(config.dataDir, { recursive: true });
  const store = new Store(path.join(config.dataDir, 'stalk.db'));
  const mailer = createMailer(config, options.logMail ?? true);
  const auth = new Auth(config, store, mailer);
  const limiter = new RateLimiter();
  const tz = config.timeZone;
  const allowedOrigin = config.publicUrl ? new URL(config.publicUrl).origin : null;
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
  function openToday(now: number): DayInfo {
    const date = dayKey(now, tz);
    return { date, theme: store.openDay(date, themeFor(date)) };
  }

  function livePost(id: string, viewerId: number): PostRow {
    const post = store.post(id, viewerId);
    if (!post || post.status !== 'live') throw new HttpError(404, 'That photo is gone.');
    return post;
  }

  // Handlers

  function session(c: Ctx): SessionInfo {
    const today = openToday(c.now);
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

  function verify(c: Ctx) {
    const { user, token } = auth.verifyCode(c.body['email'], c.body['code'], c.ip, c.now);
    c.res.setHeader('Set-Cookie', auth.sessionCookie(token));
    return { user: me(user) };
  }

  function setHandle(c: Ctx) {
    const user = signedIn(c);
    const handle = normalizeHandle(String(c.body['handle'] ?? ''));
    const problem = handleProblem(handle);
    if (problem) throw new HttpError(400, problem);
    if (user.handle === handle) return { user: me(user) };
    if (!limiter.take(`handle:${user.id}`, 3, 86_400_000, c.now)) {
      throw new HttpError(429, 'You changed your name a lot today. Try again tomorrow.');
    }
    if (!store.setHandle(user.id, handle)) throw new HttpError(409, 'That name is taken.');
    return { user: me(store.userById(user.id)!) };
  }

  function signOut(c: Ctx) {
    auth.signOut(c.req);
    c.res.setHeader('Set-Cookie', auth.sessionCookie(null));
    return { ok: true };
  }

  function themes(c: Ctx): ThemeList {
    viewer(c);
    const today = openToday(c.now);
    const upcoming = [1, 2, 3, 4, 5, 6, 7].map((i) => {
      const date = addDays(today.date, i);
      return { date, theme: themeFor(date) };
    });
    return { today, upcoming, past: store.pastDays(today.date, 120) };
  }

  function board(c: Ctx): Board {
    viewer(c);
    const today = openToday(c.now);
    const date = c.params[0] === 'today' ? today.date : c.params[0];
    if (!isDayKey(date) || date > today.date) {
      throw new HttpError(404, "That day hasn't happened yet.");
    }
    const theme = date === today.date ? today.theme : store.dayTheme(date);
    if (!theme) throw new HttpError(404, 'Nobody posted that day.');
    const uid = c.user?.id ?? -1;
    const mine = c.user ? store.postFor(c.user.id, date, uid) : undefined;
    return {
      day: { date, theme },
      isToday: date === today.date,
      posts: store.board(date, uid).map((row) => toPost(row, uid)),
      mine: mine ? toMyPost(mine, uid) : null,
    };
  }

  async function upload(c: Ctx) {
    const user = member(c);
    const today = openToday(c.now);
    const claimed = c.req.headers['x-day'];
    if (typeof claimed === 'string' && claimed !== today.date) {
      throw new HttpError(409, 'A new day just started. Check out the new theme first.');
    }
    if (store.postFor(user.id, today.date)) {
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
      const saved = store.insertPost({
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
      return { post: toMyPost(store.post(id, user.id)!, user.id) };
    } finally {
      processing--;
    }
  }

  function like(c: Ctx) {
    const user = member(c);
    const post = livePost(c.params[0], user.id);
    if (post.userId === user.id) throw new HttpError(400, 'You can’t like your own photo.');
    if (!limiter.take(`like:${user.id}`, 600, 3_600_000, c.now)) {
      throw new HttpError(429, 'Slow down a little.');
    }
    const liked = c.body['liked'] !== false;
    return { likes: store.setLike(post.id, user.id, liked, c.now), liked };
  }

  function report(c: Ctx) {
    const user = member(c);
    const post = store.post(c.params[0]);
    if (!post || (post.status !== 'live' && post.status !== 'hidden')) {
      throw new HttpError(404, 'That photo is gone.');
    }
    if (post.userId === user.id) throw new HttpError(400, 'That’s yours. You can delete it.');
    const reports = store.report(post.id, user.id, c.now);
    if (post.status === 'live' && !post.reviewed && reports >= config.reportsToHide) {
      store.setStatus(post.id, 'hidden');
    }
    return { ok: true };
  }

  async function deletePost(c: Ctx) {
    const user = signedIn(c);
    const post = store.post(c.params[0]);
    if (!post || post.userId !== user.id || (post.status !== 'live' && post.status !== 'hidden')) {
      throw new HttpError(404, 'That photo is gone.');
    }
    store.setStatus(post.id, 'deleted');
    await deleteImage(config.dataDir, post.id);
    return { ok: true };
  }

  function profile(c: Ctx): Profile {
    viewer(c);
    const target = store.userByHandle(normalizeHandle(c.params[0]));
    if (!target?.handle || target.banned) {
      throw new HttpError(404, 'Nobody here goes by that name.');
    }
    const uid = c.user?.id ?? -1;
    const isMe = uid === target.id;
    const posts = store.postsBy(target.id, uid, isMe).map((row) => ({
      ...toMyPost(row, uid),
      theme: store.dayTheme(row.day) ?? themeFor(row.day),
    }));
    const days = store.postedDays(target.id);
    return {
      handle: target.handle,
      joinedAt: target.created_at,
      streak: streakLength(days, openToday(c.now).date),
      days: days.length,
      likes: posts.reduce((sum, p) => sum + (p.status === 'live' ? p.likes : 0), 0),
      isMe,
      posts,
    };
  }

  async function image(c: Ctx) {
    const [id, kind] = c.params;
    const post = POST_ID.test(id) ? store.post(id) : undefined;
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

  function modQueue(c: Ctx): ModQueue {
    admin(c);
    return {
      items: store.modQueue().map((row) => ({
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
    const post = store.post(c.params[0]);
    if (!post || (post.status !== 'live' && post.status !== 'hidden')) {
      throw new HttpError(404, 'That photo is gone.');
    }
    const action = c.body['action'];
    if (action === 'keep') {
      store.setStatus(post.id, 'live', true);
    } else if (action === 'remove') {
      store.setStatus(post.id, 'removed', true);
      await deleteImage(config.dataDir, post.id);
    } else {
      throw new HttpError(400, "Action must be 'keep' or 'remove'.");
    }
    return { ok: true };
  }

  async function ban(c: Ctx) {
    admin(c);
    const target = store.userByHandle(normalizeHandle(c.params[0]));
    if (!target) throw new HttpError(404, 'Nobody here goes by that name.');
    if (auth.isAdmin(target)) throw new HttpError(400, 'Mods can’t be banned here.');
    const removed = store.banUser(target.id);
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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    try {
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
      ctx.user = auth.userFrom(req, ctx.now);
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

  const pruneTimer = setInterval(() => {
    const now = clock();
    store.pruneExpired(now);
    auth.limiter.prune(now);
    limiter.prune(now, 86_400_000);
  }, 3_600_000);
  pruneTimer.unref();
  store.pruneExpired(clock());

  return {
    server,
    store,
    mailer,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(pruneTimer);
        server.close(() => {
          store.close();
          resolve();
        });
        server.closeAllConnections();
      }),
  };
}
