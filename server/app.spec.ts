// End-to-end checks for the API: a real server on a random port, a temp data folder, and real
// images made with sharp. No email is sent; codes are read from the dev outbox.
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, dayKey } from '../src/app/shared/days';
import type { Board, Profile, SessionInfo } from '../src/app/shared/protocol';
import { themeFor } from '../src/app/shared/themes';
import { App, createApp } from './app';
import { loadConfig } from './config';
import { testDatabaseUrl } from './test-db';

let app: App;
let base: string;
let dataDir: string;
// Noon in Rochester on 2026-11-10, so the date doesn't depend on when the test runs.
let now = Date.parse('2026-11-10T17:00:00Z');
const DAY = 86_400_000;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'stalk-test-'));
  const config = loadConfig({
    DATA_DIR: dataDir,
    DATABASE_URL: await testDatabaseUrl(),
    ADMIN_EMAILS: 'adm0001@rit.edu',
    STATIC_DIR: path.join(dataDir, 'no-site'),
  });
  app = await createApp(config, { now: () => now, logMail: false });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

type Res<T = Record<string, unknown>> = { status: number; body: T; headers: Headers };

async function call<T = Record<string, unknown>>(
  method: string,
  url: string,
  options: { cookie?: string; json?: unknown; headers?: Record<string, string>; raw?: Buffer } = {},
): Promise<Res<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie) headers['Cookie'] = options.cookie;
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.raw) {
    body = new Uint8Array(options.raw);
  }
  const res = await fetch(base + url, { method, headers, body });
  const type = res.headers.get('content-type') ?? '';
  const parsed = type.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, body: parsed as T, headers: res.headers };
}

async function signIn(email: string, handle?: string): Promise<string> {
  const sent = await call('POST', '/api/auth/code', { json: { email } });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const code = app.mailer.outbox.at(-1)!.code;
  const res = await call('POST', '/api/auth/verify', { json: { email, code } });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  if (handle) {
    const named = await call('POST', '/api/auth/handle', { cookie, json: { handle } });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
  }
  return cookie;
}

function photo(width = 400, height = 300, color = '#4a8a3c') {
  return sharp({ create: { width, height, channels: 3, background: color } });
}

function upload(cookie: string, image: Buffer, type = 'image/jpeg', headers = {}) {
  return call<{ post: { id: string }; error?: string }>('POST', '/api/posts', {
    cookie,
    raw: image,
    headers: { 'Content-Type': type, ...headers },
  });
}

const today = () => dayKey(now, 'America/New_York');

let fern: string;
let moss: string;
let fernPost: string;

describe('signing in', () => {
  it('shows the theme to signed-out visitors but not the photos', async () => {
    const res = await call<SessionInfo>('GET', '/api/session');
    expect(res.body.user).toBeNull();
    expect(res.body.today).toEqual({ date: '2026-11-10', theme: themeFor('2026-11-10') });
    expect(res.body.membersOnly).toBe(true);
    expect((await call('GET', '/api/days/today')).status).toBe(401);
  });

  it('only accepts RIT username emails', async () => {
    for (const email of ['someone@gmail.com', 'first.last@rit.edu', 'abc1234@rit.edu.evil.com']) {
      expect((await call('POST', '/api/auth/code', { json: { email } })).status).toBe(400);
    }
  });

  it('rejects wrong codes and limits resends', async () => {
    await call('POST', '/api/auth/code', { json: { email: 'abc1234@rit.edu' } });
    const again = await call('POST', '/api/auth/code', { json: { email: 'abc1234@rit.edu' } });
    expect(again.status).toBe(429);
    const real = app.mailer.outbox.at(-1)!.code;
    const wrong = real === '000000' ? '111111' : '000000';
    const res = await call('POST', '/api/auth/verify', {
      json: { email: 'abc1234@rit.edu', code: wrong },
    });
    expect(res.status).toBe(400);
  });

  it('signs in with the right code and asks for a name', async () => {
    const code = app.mailer.outbox.at(-1)!.code;
    const res = await call('POST', '/api/auth/verify', {
      json: { email: 'ABC1234@rit.edu ', code },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax/);
    fern = res.headers.get('set-cookie')!.split(';')[0];
    const session = await call<SessionInfo>('GET', '/api/session', { cookie: fern });
    expect(session.body.user).toEqual({ handle: null, email: 'abc1234@rit.edu', isAdmin: false });
    expect((await upload(fern, await photo().jpeg().toBuffer())).status).toBe(403);
  });

  it('checks names', async () => {
    expect(
      (await call('POST', '/api/auth/handle', { cookie: fern, json: { handle: 'admin' } })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/auth/handle', { cookie: fern, json: { handle: 'a b' } })).status,
    ).toBe(400);
    expect(
      (await call('POST', '/api/auth/handle', { cookie: fern, json: { handle: '@Fern' } })).status,
    ).toBe(200);
  });

  it('treats g.rit.edu and +tags as the same account', async () => {
    moss = await signIn('xyz9876+test@g.rit.edu', 'moss');
    const session = await call<SessionInfo>('GET', '/api/session', { cookie: moss });
    expect(session.body.user?.email).toBe('xyz9876@rit.edu');
    const taken = await call('POST', '/api/auth/handle', {
      cookie: moss,
      json: { handle: 'fern' },
    });
    expect(taken.status).toBe(409);
  });
});

describe('posting', () => {
  it('only takes still images', async () => {
    expect((await upload(fern, Buffer.from('hello'), 'text/plain')).status).toBe(415);
    expect((await upload(fern, Buffer.from('fake'), 'video/mp4')).status).toBe(415);
    expect((await upload(fern, Buffer.from('not really a png'), 'image/png')).status).toBe(415);
    const frames = await Promise.all([
      photo(80, 80).png().toBuffer(),
      photo(80, 80, '#fff').png().toBuffer(),
    ]);
    const gif = await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer();
    expect((await sharp(gif).metadata()).pages).toBe(2);
    const res = await upload(fern, gif, 'image/gif');
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/Still photos only/);
  });

  it('rejects a photo sent as the day ends', async () => {
    const jpeg = await photo().jpeg().toBuffer();
    const res = await upload(fern, jpeg, 'image/jpeg', { 'X-Day': addDays(today(), -1) });
    expect(res.status).toBe(409);
  });

  it('accepts one photo, rotated upright, with metadata stripped', async () => {
    // A 400x200 photo that the camera says to rotate 90 degrees, with a GPS-style tag.
    const jpeg = await photo(400, 200)
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret location' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const res = await upload(fern, jpeg, 'image/jpeg', { 'X-Day': today() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    fernPost = res.body.post.id;

    const board = await call<Board>('GET', '/api/days/today', { cookie: fern });
    expect(board.body.mine).toMatchObject({
      id: fernPost,
      status: 'live',
      width: 200,
      height: 400,
    });

    const img = await call('GET', `/api/img/${fernPost}/full`, { cookie: moss });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(img.body as unknown as ArrayBuffer)).metadata();
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([200, 400]);
  });

  it('allows only one photo a day', async () => {
    const res = await upload(fern, await photo().jpeg().toBuffer());
    expect(res.status).toBe(409);
  });

  it('keeps photos away from signed-out visitors', async () => {
    expect((await call('GET', `/api/img/${fernPost}/thumb`)).status).toBe(404);
  });
});

describe('likes, reports and mods', () => {
  let mossPost: string;

  it('likes other photos but not your own', async () => {
    mossPost = (await upload(moss, await photo(300, 300).png().toBuffer(), 'image/png')).body.post
      .id;
    const liked = await call('POST', `/api/posts/${fernPost}/like`, {
      cookie: moss,
      json: { liked: true },
    });
    expect(liked.body).toEqual({ likes: 1, liked: true });
    const twice = await call('POST', `/api/posts/${fernPost}/like`, {
      cookie: moss,
      json: { liked: true },
    });
    expect(twice.body).toEqual({ likes: 1, liked: true });
    const own = await call('POST', `/api/posts/${mossPost}/like`, {
      cookie: moss,
      json: { liked: true },
    });
    expect(own.status).toBe(400);

    const board = await call<Board>('GET', '/api/days/today', { cookie: moss });
    expect(board.body.posts.map((p) => [p.handle, p.likes, p.liked, p.mine])).toEqual([
      ['moss', 0, false, true],
      ['fern', 1, true, false],
    ]);
  });

  it('blocks posts from other sites', async () => {
    const res = await call('POST', `/api/posts/${fernPost}/like`, {
      cookie: moss,
      json: { liked: false },
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });

  it('hides a photo after three reports until a mod looks', async () => {
    const reporters = [
      moss,
      await signIn('rpt0001@rit.edu', 'reporter_one'),
      await signIn('rpt0002@rit.edu', 'reporter_two'),
    ];
    for (const cookie of reporters) {
      expect(
        (await call('POST', `/api/posts/${fernPost}/report`, { cookie, json: {} })).status,
      ).toBe(200);
    }
    const board = await call<Board>('GET', '/api/days/today', { cookie: moss });
    expect(board.body.posts.map((p) => p.id)).toEqual([mossPost]);
    const mine = await call<Board>('GET', '/api/days/today', { cookie: fern });
    expect(mine.body.mine?.status).toBe('hidden');
    expect((await call('GET', `/api/img/${fernPost}/thumb`, { cookie: fern })).status).toBe(200);
    expect((await call('GET', `/api/img/${fernPost}/thumb`, { cookie: moss })).status).toBe(404);

    expect((await call('GET', '/api/mod/queue', { cookie: moss })).status).toBe(403);
    const mod = await signIn('adm0001@rit.edu', 'gardener');
    const queue = await call<{ items: { post: { id: string }; reports: number; email: string }[] }>(
      'GET',
      '/api/mod/queue',
      { cookie: mod },
    );
    expect(queue.body.items).toMatchObject([
      { post: { id: fernPost }, reports: 3, email: 'abc1234@rit.edu' },
    ]);
    await call('POST', `/api/mod/posts/${fernPost}`, { cookie: mod, json: { action: 'keep' } });
    const after = await call<Board>('GET', '/api/days/today', { cookie: moss });
    expect(after.body.posts).toHaveLength(2);
  });

  it('lets mods ban someone, which takes their photos down and signs them out', async () => {
    const mod = await signIn('adm0001@rit.edu');
    const res = await call('POST', '/api/mod/users/moss/ban', { cookie: mod, json: {} });
    expect(res.body).toEqual({ ok: true, removed: 1 });
    const session = await call<SessionInfo>('GET', '/api/session', { cookie: moss });
    expect(session.body.user).toBeNull();
    expect(
      (await call('POST', '/api/auth/code', { json: { email: 'xyz9876@rit.edu' } })).status,
    ).toBe(403);
    expect((await call('GET', `/api/img/${mossPost}/full`, { cookie: fern })).status).toBe(404);
  });
});

describe('days', () => {
  it('starts a new theme at midnight and keeps the streak going', async () => {
    const before = today();
    now += DAY;
    expect(today()).toBe(addDays(before, 1));
    const session = await call<SessionInfo>('GET', '/api/session', { cookie: fern });
    expect(session.body.today.theme).toBe(themeFor(today()));
    expect((await upload(fern, await photo().jpeg().toBuffer())).status).toBe(200);

    const profile = await call<Profile>('GET', '/api/users/fern', { cookie: fern });
    expect(profile.body).toMatchObject({
      handle: 'fern',
      streak: 2,
      days: 2,
      likes: 1,
      isMe: true,
    });
    expect(profile.body.posts.map((p) => p.theme)).toEqual([themeFor(today()), themeFor(before)]);

    const past = await call<Board>('GET', `/api/days/${before}`, { cookie: fern });
    expect(past.body).toMatchObject({ isToday: false, day: { date: before } });
    expect((await call('GET', `/api/days/${addDays(today(), 1)}`, { cookie: fern })).status).toBe(
      404,
    );
  });

  it('lists upcoming and past themes', async () => {
    const res = await call<{ upcoming: unknown[]; past: { date: string; posts: number }[] }>(
      'GET',
      '/api/days',
      { cookie: fern },
    );
    expect(res.body.upcoming).toHaveLength(7);
    expect(res.body.past[0]).toMatchObject({ date: addDays(today(), -1), posts: 1 });
  });

  it('keeps the day used after you delete your photo', async () => {
    const board = await call<Board>('GET', '/api/days/today', { cookie: fern });
    const id = board.body.mine!.id;
    expect((await call('POST', `/api/posts/${id}/delete`, { cookie: fern, json: {} })).status).toBe(
      200,
    );
    expect((await upload(fern, await photo().jpeg().toBuffer())).status).toBe(409);
    const after = await call<Board>('GET', '/api/days/today', { cookie: fern });
    expect(after.body.mine?.status).toBe('deleted');

    const own = await call<Profile>('GET', '/api/users/fern', { cookie: fern });
    expect(own.body.calendar).toEqual([
      { day: today(), status: 'deleted', id: null },
      { day: addDays(today(), -1), status: 'posted', id: fernPost },
    ]);
    const viewer = await signIn('vwr0001@rit.edu', 'viewer');
    const theirs = await call<Profile>('GET', '/api/users/fern', { cookie: viewer });
    expect(theirs.body.calendar).toEqual([
      { day: addDays(today(), -1), status: 'posted', id: fernPost },
    ]);
  });
});
