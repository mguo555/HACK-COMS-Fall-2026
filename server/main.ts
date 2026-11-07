// API server for "Will AI Beat Us?". Runs every table and keeps the Gemini key off the browser.
//
//   GET  /api/health                     → { ok, ai }
//   POST /api/rooms                      { name, settings }  → { code, token }
//   POST /api/rooms/:code/join           { name }            → { code, token }
//   GET  /api/rooms/:code/events?token=  Server-Sent Events: your ClientState on every change
//   POST /api/rooms/:code/start|ready|leave
//   POST /api/rooms/:code/act            { action }
//   POST /api/rooms/:code/message        { botId, text }
//   POST /api/rooms/:code/announce       { text }
//   GET  /api/history?name=              → { rounds }  (what the bots remember about a name)
//   POST /api/history/forget             { name }
//
// POSTs carry the player token in the X-Player-Token header. Types: src/app/shared/protocol.ts.
import './env.mjs';
import http from 'node:http';
import * as ai from './ai';
import { forgetPlayer, loadPlayer } from './history-store';
import { RoomError, cleanName } from './room';
import { createRoom, getRoom } from './rooms';

const PORT = Number(process.env['PORT']) || 3001;
// Loopback only by default, so other machines on the network can't reach the server directly.
// (On a tailnet, `npm run dev:tailnet` exposes the web server, which forwards /api here.)
const HOST = process.env['HOST'] || '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;

type Body = Record<string, unknown>;
type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Body,
  params: string[],
  url: URL,
) => unknown;

const routes: [method: string, pattern: RegExp, handler: Handler][] = [
  ['GET', /^\/api\/health$/, async () => ({ ok: true, ai: await ai.aiStatus() })],

  [
    'POST',
    /^\/api\/rooms$/,
    (_req, _res, body) => {
      const room = createRoom(body['settings'] as never);
      const human = room.join(String(body['name'] ?? ''), body['profile'] as never);
      return { code: room.code, token: human.token };
    },
  ],

  [
    'POST',
    /^\/api\/rooms\/([A-Za-z]{4})\/join$/,
    (_req, _res, body, [code]) => {
      const room = getRoom(code);
      const human = room.join(String(body['name'] ?? ''), body['profile'] as never);
      return { code: room.code, token: human.token };
    },
  ],

  [
    'GET',
    /^\/api\/rooms\/([A-Za-z]{4})\/events$/,
    (_req, res, _body, [code], url) => {
      const room = getRoom(code);
      room.subscribe(room.byToken(url.searchParams.get('token')), res);
      return STREAMING;
    },
  ],

  ['POST', /^\/api\/rooms\/([A-Za-z]{4})\/start$/, withHuman((room, human) => room.start(human))],
  [
    'POST',
    /^\/api\/rooms\/([A-Za-z]{4})\/ready$/,
    withHuman((room, human) => room.markReady(human)),
  ],
  ['POST', /^\/api\/rooms\/([A-Za-z]{4})\/leave$/, withHuman((room, human) => room.leave(human))],
  [
    'POST',
    /^\/api\/rooms\/([A-Za-z]{4})\/act$/,
    withHuman((room, human, body) => room.act(human, body['action'] as never)),
  ],
  [
    'POST',
    /^\/api\/rooms\/([A-Za-z]{4})\/message$/,
    withHuman((room, human, body) =>
      room.sendMessage(human, String(body['botId']), String(body['text'] ?? '')),
    ),
  ],
  [
    'POST',
    /^\/api\/rooms\/([A-Za-z]{4})\/announce$/,
    withHuman((room, human, body) => room.announce(human, String(body['text'] ?? ''))),
  ],

  [
    'GET',
    /^\/api\/history$/,
    (_req, _res, _body, _params, url) => ({
      rounds: loadPlayer(cleanName(url.searchParams.get('name')))?.rounds ?? 0,
    }),
  ],
  [
    'POST',
    /^\/api\/history\/forget$/,
    (_req, _res, body) => {
      forgetPlayer(cleanName(body['name']));
      return { ok: true };
    },
  ],
];

const STREAMING = Symbol('streaming');

/** Wraps a room action that needs the caller's token; replies { ok: true } when done. */
function withHuman(
  fn: (
    room: ReturnType<typeof getRoom>,
    human: ReturnType<ReturnType<typeof getRoom>['byToken']>,
    body: Body,
  ) => unknown,
): Handler {
  return async (req, _res, body, [code]) => {
    const room = getRoom(code);
    const token = req.headers['x-player-token'];
    await fn(room, room.byToken(Array.isArray(token) ? token[0] : token), body);
    return { ok: true };
  };
}

function readJson(req: http.IncomingMessage): Promise<Body> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new RoomError(413, 'Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new RoomError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = routes.find(
    ([method, pattern]) => method === req.method && pattern.test(url.pathname),
  );
  if (!route) return send(res, 404, { error: 'Not found' });
  const [, pattern, handler] = route;
  const params = (url.pathname.match(pattern) ?? []).slice(1);
  try {
    // Requiring a JSON content type means a web page on another origin can't fire requests at
    // this server without a CORS preflight, which it never approves.
    if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) {
      throw new RoomError(415, 'Expected application/json');
    }
    const body = req.method === 'POST' ? await readJson(req) : {};
    const result = await handler(req, res, body, params, url);
    if (result !== STREAMING) send(res, 200, result);
  } catch (error) {
    const status = error instanceof RoomError ? error.status : 500;
    if (status >= 500) console.error(`[api] ${req.method} ${url.pathname} failed:`, error);
    send(res, status, { error: error instanceof Error ? error.message : 'Something went wrong' });
  }
});

// If the port is taken (or any listen error), stop: a server that isn't listening is useless.
server.on('error', (error) => {
  console.error(`[api] could not start on ${HOST}:${PORT}:`, error.message);
  process.exit(1);
});

// One table's bug shouldn't take down every other table.
process.on('unhandledRejection', (error) => console.error('[api] unhandled rejection:', error));
process.on('uncaughtException', (error) => console.error('[api] uncaught exception:', error));

server.listen(PORT, HOST, async () => {
  console.log(`[api] listening on http://${HOST}:${PORT}`);
  const status = await ai.aiStatus();
  console.log(
    status.enabled
      ? `[api] Gemini (${status.model}) is live. Calls today: ${status.usedToday}/${status.perDay || 'no limit'}`
      : `[api] Gemini offline: ${status.reason}. Bots will use built-in logic.`,
  );
});
