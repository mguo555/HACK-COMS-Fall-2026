// Small HTTP helpers: errors, bodies, cookies, rate limits and static files. No framework.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

/** Thrown by route handlers. `message` is shown to the user, so keep it plain and friendly. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

export function readBody(
  req: http.IncomingMessage,
  limit: number,
  tooBig = 'That request is too large.',
): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) return Promise.reject(new HttpError(413, tooBig));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, tooBig));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, 16 * 1024);
  if (!raw.length) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON.');
  }
}

export function getCookie(req: http.IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Who's asking, for rate limits. Behind Cloudflare (or its tunnel) every request arrives from the
 * same local address, so with TRUST_PROXY on we read the visitor's address from the headers.
 */
export function clientIp(req: http.IncomingMessage, behindProxy: boolean): string {
  if (behindProxy) {
    const cloudflare = req.headers['cf-connecting-ip'];
    if (typeof cloudflare === 'string' && cloudflare.trim()) return cloudflare.trim();
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Fixed-window counters kept in memory. Good enough for one server process. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  /** Counts one hit for `key`. False when the key is over `max` hits in the last `windowMs`. */
  take(key: string, max: number, windowMs: number, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= max;
  }

  prune(now = Date.now(), maxAge = 3_600_000): void {
    for (const [key, w] of this.windows) if (now - w.start > maxAge) this.windows.delete(key);
  }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export const PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** Serves the built Angular app. Unknown paths get index.html so client-side routes work. */
export async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  root: string,
  pathname: string,
): Promise<void> {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escapes just get the app shell.
  }
  let file = path.join(root, path.normalize(decoded).replace(/^([/\\.])+/, ''));
  if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    file = path.join(root, 'index.html');
    info = await stat(file);
  }
  const ext = path.extname(file);
  // Angular puts a content hash in built file names, so those can be cached forever.
  const hashed = /-[A-Z0-9]{8}\.(js|css)$/.test(file);
  res.writeHead(200, {
    ...PAGE_HEADERS,
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}
