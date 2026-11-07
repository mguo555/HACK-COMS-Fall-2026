// Every Gemini call goes through here: status check, cooldown, usage caps, then the call. If any
// step says no, the built-in logic answers instead and the caller gets a short notice to show.
import type { BotContext, BotDecision, ChatReply } from '../src/app/ai/ai.types';
import { offlineDecision, offlineReply } from '../src/app/ai/offline-bot';
import type { OfflineStyle, Persona } from '../src/app/shared/personas';
import type { Leaning, Reaction } from '../src/app/shared/protocol';
// @ts-expect-error plain JS module
import { GEMINI_MODEL, askGemini, checkGemini, geminiCooldown, geminiLimiter } from './gemini.mjs';
import {
  type TableVoice,
  CHAT_SCHEMA,
  DECISION_SCHEMA,
  chatPrompt,
  decisionPrompt,
  reactionPrompt,
  reactionSchema,
  systemPrompt,
} from './prompts';

const ACTIONS = new Set(['fold', 'check', 'call', 'raise']);
const LEANINGS = new Set(['fold', 'call', 'raise', 'unchanged']);

export type { TableVoice } from './prompts';

export interface AiResult<T> {
  value: T;
  /** Plain-language note when Gemini was skipped or failed (null when all went well). */
  notice: string | null;
}

export interface AiStatus {
  enabled: boolean;
  model: string;
  reason: string | null;
  usedToday: number;
  perDay: number;
}

export async function aiStatus(): Promise<AiStatus> {
  const s = await checkGemini();
  const stats = geminiLimiter.stats();
  return {
    enabled: s.enabled,
    model: GEMINI_MODEL,
    reason: s.reason,
    usedToday: stats.usedToday,
    perDay: stats.perDay,
  };
}

type Attempt = { ok: true; data: Record<string, unknown> } | { ok: false; notice: string | null };

/** Runs one Gemini call if allowed. `what` names it in notices ("Rosie's move"). */
async function attempt(
  what: string,
  label: string,
  build: () => { system: string; prompt: string; schema: object },
): Promise<Attempt> {
  const status = await checkGemini();
  if (!status.enabled) return { ok: false, notice: null }; // offline mode; the page already says so
  const resting = geminiCooldown();
  if (resting) return { ok: false, notice: `${resting}. Built-in logic handled ${what}.` };
  const limited = geminiLimiter.take();
  if (limited) return { ok: false, notice: `${limited}. Built-in logic handled ${what}.` };
  try {
    const { system, prompt, schema } = build();
    return { ok: true, data: await askGemini({ system, prompt, schema, label }) };
  } catch (error) {
    console.error(`[ai] ${label} failed:`, error instanceof Error ? error.message : error);
    return { ok: false, notice: `Gemini didn't answer for ${what}, so built-in logic stepped in.` };
  }
}

export async function decide(
  persona: Persona,
  voice: TableVoice,
  ctx: BotContext,
  useAi: boolean,
): Promise<AiResult<BotDecision>> {
  const fallback = () => offlineDecision(ctx.view, moodStyle(persona.offline, ctx));
  if (!useAi) return { value: fallback(), notice: null };
  const result = await attempt(`${persona.name}'s move`, `decide:${persona.id}`, () => ({
    system: systemPrompt(persona, voice),
    prompt: decisionPrompt(ctx, persona),
    schema: DECISION_SCHEMA,
  }));
  if (!result.ok) return { value: fallback(), notice: result.notice };
  const d = result.data;
  if (!ACTIONS.has(String(d['action']))) return { value: fallback(), notice: null };
  return {
    value: {
      action: d['action'] as BotDecision['action'],
      raiseTo: Math.round(Number(d['raise_to']) || 0),
      tableTalk: plainText(d['table_talk'], 200),
      thought: plainText(d['thought'], 300),
      influence: percent(d['influence']),
      offline: false,
    },
    notice: null,
  };
}

export async function chatReply(
  persona: Persona,
  humanName: string,
  voice: TableVoice,
  ctx: BotContext,
  message: string,
): Promise<AiResult<ChatReply>> {
  const result = await attempt(`${persona.name}'s reply`, `chat:${persona.id}`, () => ({
    system: systemPrompt(persona, voice),
    prompt: chatPrompt(ctx, persona, humanName, message),
    schema: CHAT_SCHEMA,
  }));
  if (!result.ok) {
    return {
      value: {
        text: offlineReply(persona.offline),
        sway: null,
        leaning: null,
        feeling: null,
        offline: true,
      },
      notice: result.notice,
    };
  }
  return {
    value: {
      text: plainText(result.data['reply'], 400),
      sway: percent(result.data['sway']),
      leaning: leaning(result.data['leaning']),
      feeling: ['warmer', 'colder', 'same'].includes(String(result.data['feeling']))
        ? (String(result.data['feeling']) as ChatReply['feeling'])
        : null,
      offline: false,
    },
    notice: null,
  };
}

/** Moods change how the built-in logic plays too: tilted players get loose and wild. */
function moodStyle(style: OfflineStyle, ctx: BotContext): OfflineStyle {
  const bump = (n: number, d: number) => Math.min(1, Math.max(0, n + d));
  switch (ctx.mood?.label) {
    case 'tilted':
      return {
        ...style,
        aggression: bump(style.aggression, 0.2),
        looseness: bump(style.looseness, 0.2),
      };
    case 'shaken':
      return {
        ...style,
        aggression: bump(style.aggression, -0.15),
        looseness: bump(style.looseness, -0.1),
      };
    case 'on a heater':
      return { ...style, aggression: bump(style.aggression, 0.1) };
    default:
      return style;
  }
}

/** All AI players still in the hand react to one announcement, in a single call. */
export async function reactions(
  bots: { persona: Persona; ctx: BotContext }[],
  announcer: string,
  text: string,
  voice: TableVoice,
): Promise<AiResult<{ reactions: Reaction[]; offline: boolean }>> {
  if (!bots.length) return { value: { reactions: [], offline: false }, notice: null };
  const ids = bots.map((b) => b.persona.id);
  const result = await attempt('the table reactions', 'react', () => {
    const { system, prompt } = reactionPrompt(bots, announcer, text, voice);
    return { system, prompt, schema: reactionSchema(ids) };
  });
  if (!result.ok) {
    // Built-in: a couple of canned lines, no sway reading.
    const list = bots.slice(0, 2).map((b) => ({
      botId: b.persona.id,
      say: offlineReply(b.persona.offline),
      sway: null,
      leaning: null,
    }));
    return { value: { reactions: list, offline: true }, notice: result.notice };
  }
  const raw = Array.isArray(result.data['reactions']) ? result.data['reactions'] : [];
  const seen = new Set<string>();
  const list: Reaction[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const id = String(r['player']);
    if (!ids.includes(id) || seen.has(id)) continue;
    seen.add(id);
    list.push({
      botId: id,
      say: plainText(r['say'], 200),
      sway: percent(r['sway']),
      leaning: leaning(r['leaning']),
    });
  }
  return { value: { reactions: list, offline: false }, notice: null };
}

/**
 * Tidies model text before it reaches the screen: no em/en dashes, no wrapping quotes,
 * no stray whitespace. The prompt asks for this too; this is the backstop.
 */
export function plainText(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s*--\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“](.*)["”]$/, '$1')
    .replace(/^,\s*|,\s*$/g, '')
    .slice(0, max);
}

function percent(value: unknown): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

function leaning(value: unknown): Leaning | null {
  return LEANINGS.has(String(value)) ? (String(value) as Leaning) : null;
}
