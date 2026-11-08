// How the server behaves behind Cloudflare with PUBLIC_URL=https://...: one canonical address,
// HSTS, and sessions that keep active people signed in.
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App, createApp } from './app';
import { loadConfig } from './config';
import { testDatabaseUrl } from './test-db';

let app: App;
let port: number;
let dataDir: string;
let now = Date.parse('2026-11-10T17:00:00Z');
const DAY = 86_400_000;

beforeAll(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'stalk-prod-'));
  const config = loadConfig({
    DATA_DIR: dataDir,
    DATABASE_URL: await testDatabaseUrl(),
    PUBLIC_URL: 'https://stalk.photo',
    TRUST_PROXY: 'true',
    STATIC_DIR: path.join(dataDir, 'no-site'),
  });
  app = await createApp(config, { now: () => now, logMail: false });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  port = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A raw request, so tests can set Host and the headers Cloudflare adds. */
function send(
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: { Host: 'stalk.photo', ...headers },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.setHeader('Content-Type', 'application/json');
      req.end(JSON.stringify(body));
    } else {
      req.end();
    }
  });
}

const viaCloudflare = (proto: 'http' | 'https', extra: Record<string, string> = {}) => ({
  'X-Forwarded-Proto': proto,
  'CF-Connecting-IP': '203.0.113.7',
  ...extra,
});

describe('canonical address', () => {
  it('sends http visitors to https, keeping the path', async () => {
    const res = await send('GET', '/themes?x=1', viaCloudflare('http'));
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('https://stalk.photo/themes?x=1');
  });

  it('sends www to the bare domain, and keeps POSTs as POSTs', async () => {
    const get = await send('GET', '/', viaCloudflare('https', { Host: 'www.stalk.photo' }));
    expect(get.headers.location).toBe('https://stalk.photo/');
    const post = await send('POST', '/api/auth/code', viaCloudflare('http'), {});
    expect(post.status).toBe(308);
  });

  it('serves https requests with HSTS', async () => {
    const res = await send('GET', '/api/session', viaCloudflare('https'));
    expect(res.status).toBe(200);
    expect(res.headers['strict-transport-security']).toBe('max-age=15552000');
  });

  it('leaves direct requests alone (health checks, Tailscale)', async () => {
    const res = await send('GET', '/api/health');
    expect(res.status).toBe(200);
  });
});

describe('sessions', () => {
  let cookie: string;

  it('signs in with an https-only cookie', async () => {
    const headers = viaCloudflare('https', { Origin: 'https://stalk.photo' });
    await send('POST', '/api/auth/code', headers, { email: 'abc1234@rit.edu' });
    const code = app.mailer.outbox.at(-1)!.code;
    const res = await send('POST', '/api/auth/verify', headers, { email: 'abc1234@rit.edu', code });
    expect(res.status).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
    cookie = setCookie.split(';')[0];
  });

  it('keeps active people signed in past the original 30 days', async () => {
    now += 20 * DAY;
    const touched = await send('GET', '/api/session', viaCloudflare('https', { Cookie: cookie }));
    expect(JSON.parse(touched.body).user.email).toBe('abc1234@rit.edu');
    expect(String(touched.headers['set-cookie'])).toMatch(/^stalk_session=.+Max-Age=2592000/);

    now += 20 * DAY; // 40 days after signing in, 20 after last use
    const later = await send('GET', '/api/session', viaCloudflare('https', { Cookie: cookie }));
    expect(JSON.parse(later.body).user?.email).toBe('abc1234@rit.edu');
  });

  it('signs people out after 30 days away', async () => {
    now += 31 * DAY;
    const res = await send('GET', '/api/session', viaCloudflare('https', { Cookie: cookie }));
    expect(JSON.parse(res.body).user).toBeNull();
  });
});
