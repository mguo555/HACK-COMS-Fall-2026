// API server for "Will AI Beat Us?". Keeps the Anthropic key off the browser.
//
//   GET  /api/health  → { ok, ai: { enabled, model, reason } }
//   POST /api/decide  → { decision: { action, raiseTo, tableTalk, thought } }
//   POST /api/chat    → { reply }
//
// Request bodies are described in docs/ARCHITECTURE.md.
import './env.mjs';
import http from 'node:http';
import { EFFORT, MODEL, askClaude, checkAi } from './claude.mjs';
import { getPersona } from './personas.mjs';
import {
  CHAT_SCHEMA,
  DECISION_SCHEMA,
  chatPrompt,
  decisionPrompt,
  systemPrompt,
} from './prompts.mjs';

const PORT = Number(process.env.PORT) || 3001;
const MAX_BODY_BYTES = 64 * 1024;
const ACTIONS = new Set(['fold', 'check', 'call', 'raise']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const routes = {
  'GET /api/health': async () => {
    const ai = await checkAi();
    return {
      ok: true,
      ai: { enabled: ai.enabled, model: MODEL, effort: EFFORT || 'default', reason: ai.reason },
    };
  },

  'POST /api/decide': async (body) => {
    const { persona, humanName } = await prepare(body);
    const result = await askClaude({
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
        tableTalk: String(result.table_talk ?? '').slice(0, 200),
        thought: String(result.thought ?? '').slice(0, 300),
      },
    };
  },

  'POST /api/chat': async (body) => {
    const { persona, humanName } = await prepare(body);
    if (!String(body.message ?? '').trim()) throw new HttpError(400, 'message is required');
    const result = await askClaude({
      label: `chat:${persona.id}`,
      system: systemPrompt(persona, humanName),
      prompt: chatPrompt(body, persona, humanName),
      schema: CHAT_SCHEMA,
    });
    return { reply: String(result.reply ?? '').slice(0, 400) };
  },
};

async function prepare(body) {
  const persona = getPersona(body?.personaId);
  if (!persona) throw new HttpError(400, 'unknown personaId');
  const ai = await checkAi();
  if (!ai.enabled) throw new HttpError(503, `AI is offline: ${ai.reason}`);
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
    const body = req.method === 'POST' ? await readJson(req) : {};
    send(res, 200, await handler(body));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    if (status === 502) console.error(`[api] ${req.method} ${path} failed:`, error.message);
    send(res, status, { error: error.message });
  }
});

server.listen(PORT, async () => {
  console.log(
    `[api] listening on http://localhost:${PORT} (model ${MODEL}, effort ${EFFORT || 'default'})`,
  );
  const ai = await checkAi();
  console.log(
    ai.enabled
      ? '[api] Claude is reachable — AI players are live'
      : `[api] AI offline: ${ai.reason}. Bots will use built-in logic.`,
  );
});
