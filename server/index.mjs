// API server for "Will AI Beat Us?". Keeps the Gemini API key off the browser.
//
//   GET  /api/health  → { ok, ai: { enabled, model, reason, perMinute, perDay, usedToday } }
//   POST /api/decide  → { decision: { action, raiseTo, tableTalk, thought } }
//   POST /api/chat    → { reply }
//
// Request bodies are described in docs/ARCHITECTURE.md.
import './env.mjs';
import http from 'node:http';
import { GEMINI_MODEL, askGemini, checkGemini, geminiCooldown, geminiLimiter } from './gemini.mjs';
import { PERSONAS, getPersona } from './personas.mjs';
import {
  CHAT_SCHEMA,
  DECISION_SCHEMA,
  chatPrompt,
  decisionPrompt,
  systemPrompt,
} from './prompts.mjs';

const PORT = Number(process.env.PORT) || 3001;
// Loopback only by default, so other machines on the network (e.g. hackathon Wi-Fi) can't use
// the server to spend your API quota. Set HOST=0.0.0.0 only if you really need LAN access.
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;
const ACTIONS = new Set(['fold', 'check', 'call', 'raise']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function aiStatus() {
  const s = await checkGemini();
  return { enabled: s.enabled, model: GEMINI_MODEL, reason: s.reason, ...geminiLimiter.stats() };
}

const routes = {
  'GET /api/health': async () => ({ ok: true, ai: await aiStatus() }),

  'POST /api/decide': async (body) => {
    const { persona, humanName } = await prepare(body);
    const result = await askGemini({
      label: `decide:${persona.id}`,
      system: systemPrompt(persona, humanName),
      prompt: decisionPrompt(body, persona, humanName),
      schema: DECISION_SCHEMA,
    });
    if (!ACTIONS.has(result.action)) throw new Error(`Unexpected action ${result.action}`);
    return {
      decision: {
        action: result.action,
        raiseTo: Math.round(Number(result.raise_to) || 0),
        tableTalk: plainText(result.table_talk, 200),
        thought: plainText(result.thought, 300),
      },
    };
  },

  'POST /api/chat': async (body) => {
    if (!String(body?.message ?? '').trim()) throw new HttpError(400, 'message is required');
    const { persona, humanName } = await prepare(body);
    const result = await askGemini({
      label: `chat:${persona.id}`,
      system: systemPrompt(persona, humanName),
      prompt: chatPrompt(body, persona, humanName),
      schema: CHAT_SCHEMA,
    });
    return { reply: plainText(result.reply, 400) };
  },
};

/**
 * Tidies model text before it reaches the screen: no em/en dashes, no wrapping quotes,
 * no stray whitespace. The prompt asks for this too; this is the backstop.
 */
function plainText(value, max) {
  return String(value ?? '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*--\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“](.*)["”]$/, '$1')
    .replace(/^,\s*|,\s*$/g, '')
    .slice(0, max);
}

async function prepare(body) {
  const persona = getPersona(body?.personaId);
  if (!persona) throw new HttpError(400, 'unknown personaId');
  const status = await checkGemini();
  if (!status.enabled) throw new HttpError(503, `Gemini is offline: ${status.reason}`);
  const resting = geminiCooldown();
  if (resting) throw new HttpError(429, resting);
  // Counted before the call, so failed calls also count toward the cap.
  const limited = geminiLimiter.take();
  if (limited) throw new HttpError(429, limited);
  const humanName =
    String(body.humanName ?? '')
      .replace(/[^\p{L}\p{N} _.'-]/gu, '')
      .trim()
      .slice(0, 24) || 'Player';
  return { persona, humanName };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  const handler = routes[`${req.method} ${path}`];
  if (!handler) return send(res, 404, { error: 'not found' });
  try {
    // Requiring a JSON content type means a web page on another origin can't fire requests at
    // this server without a CORS preflight, which it never approves.
    if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) {
      throw new HttpError(415, 'expected application/json');
    }
    const body = req.method === 'POST' ? await readJson(req) : {};
    send(res, 200, await handler(body));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    if (status === 502) console.error(`[api] ${req.method} ${path} failed:`, error.message);
    else if (status === 429) console.warn(`[api] ${error.message}`);
    send(res, status, { error: error.message });
  }
});

server.listen(PORT, HOST, async () => {
  console.log(`[api] listening on http://${HOST}:${PORT}`);
  const ai = await aiStatus();
  const names = Object.values(PERSONAS)
    .map((p) => p.name)
    .join(', ');
  console.log(
    ai.enabled
      ? `[api] Gemini (${ai.model}) plays ${names}. Calls today: ${ai.usedToday}/${ai.perDay || 'no limit'}, max ${ai.perMinute || 'unlimited'} per minute`
      : `[api] Gemini offline: ${ai.reason}. Bots will use built-in logic.`,
  );
});
