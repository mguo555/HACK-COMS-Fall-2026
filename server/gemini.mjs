// Gemini plays every AI character. Keys and model names come from .env (see .env.example).
import { ApiError, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { createLimiter, envLimit } from './usage.mjs';

// Flash-Lite: the fastest tier, with the most generous free-tier quota, and plenty for short
// in-character lines. (gemini-2.5-flash is closed to new keys; gemini-3.8-flash was returning
// "high demand" errors on the free tier when this was set up.) Low thinking and short outputs keep
// each call to a few hundred tokens.
export const GEMINI_MODEL = process.env.POKER_GEMINI_MODEL || 'gemini-3.5-flash-lite';

const THINKING = /^gemini-2\.5-flash/.test(GEMINI_MODEL)
  ? { thinkingBudget: 0 } // 2.5 Flash: thinking off
  : { thinkingLevel: ThinkingLevel.LOW }; // Gemini 3 and later

/** Hard cap on calls, so a long session can't exhaust the free tier (or run up a bill). */
export const geminiLimiter = createLimiter('Gemini', {
  perMinute: envLimit('POKER_GEMINI_PER_MINUTE', 8),
  perDay: envLimit('POKER_GEMINI_PER_DAY', 200),
});

const TIMEOUT_MS = envLimit('POKER_GEMINI_TIMEOUT_MS', 45_000);
/** After Google says it's busy or out of quota, wait this long before calling again. */
const COOLDOWN_MS = 30_000;

const apiKey = process.env.GEMINI_API_KEY;
const client = apiKey ? new GoogleGenAI({ apiKey }) : null;

let status = { enabled: false, reason: 'not checked yet' };
/** Set when Google rejects the key or model during a call. Stays until the server restarts. */
let blockedReason = null;
let cooldownUntil = 0;

/** Why Gemini shouldn't be called right now (busy or over quota), or null. */
export function geminiCooldown() {
  const seconds = Math.ceil((cooldownUntil - Date.now()) / 1000);
  return seconds > 0 ? `Gemini is busy, so it's resting for ${seconds}s` : null;
}

/** Confirms the key and model work, using the (free) model metadata endpoint. Cached on success. */
export async function checkGemini() {
  if (blockedReason) return { enabled: false, reason: blockedReason };
  if (status.enabled) return status;
  if (!client) {
    status = { enabled: false, reason: 'no GEMINI_API_KEY in .env' };
    return status;
  }
  try {
    await client.models.get({ model: GEMINI_MODEL });
    status = { enabled: true, reason: null };
  } catch (error) {
    status = { enabled: false, reason: describeError(error) };
  }
  return status;
}

/** Sends one request and returns the parsed JSON object matching `schema`. */
export async function askGemini({ system, prompt, schema, label }) {
  if (!client) throw new Error('Gemini is not configured');
  const started = Date.now();
  let response;
  try {
    response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction: system,
        responseMimeType: 'application/json',
        responseJsonSchema: schema,
        maxOutputTokens: 1024,
        thinkingConfig: THINKING,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });
  } catch (error) {
    // A missing model or rejected key won't fix itself: stop calling until the server restarts.
    if (isPermanent(error)) blockedReason = describeError(error);
    // Busy or rate-limited: back off instead of retrying every turn.
    if (error instanceof ApiError && (error.status === 429 || error.status === 503)) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
    }
    throw error;
  }

  const meta = response.usageMetadata ?? {};
  const finish = response.candidates?.[0]?.finishReason ?? 'unknown';
  console.log(
    `[gemini] ${label} ${Date.now() - started}ms in=${meta.promptTokenCount ?? '?'} out=${meta.candidatesTokenCount ?? '?'} finish=${finish}`,
  );

  const text = response.text;
  if (!text) throw new Error(`Gemini returned no text (finish reason: ${finish})`);
  return JSON.parse(text);
}

function isPermanent(error) {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401 || error.status === 403 || error.status === 404) return true;
  return error.status === 400 && /api key/i.test(error.message);
}

function describeError(error) {
  if (error instanceof ApiError) {
    if (error.status === 404) return `model ${GEMINI_MODEL} can't be used with this key`;
    if (isPermanent(error)) return 'the Gemini API key was rejected';
  }
  return error instanceof Error ? error.message : String(error);
}
