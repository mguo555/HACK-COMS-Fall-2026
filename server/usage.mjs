// Caps how often the AI is called, so a long session (or a bug) can't burn through a
// free-tier quota or run up a bill. Daily counts are saved to .data/ai-usage.json (git-ignored)
// so restarting the server doesn't reset them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE_FILE = fileURLToPath(new URL('../.data/ai-usage.json', import.meta.url));

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

let usage = load();

function load() {
  try {
    if (existsSync(USAGE_FILE)) {
      const data = JSON.parse(readFileSync(USAGE_FILE, 'utf8'));
      if (data.date === today() && data.counts) return data;
    }
  } catch {
    // Corrupt or unreadable file: start fresh.
  }
  return { date: today(), counts: {} };
}

function save() {
  try {
    mkdirSync(dirname(USAGE_FILE), { recursive: true });
    writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch (error) {
    console.warn('[usage] could not save usage counts:', error.message);
  }
}

function usedToday(name) {
  if (usage.date !== today()) usage = { date: today(), counts: {} };
  return usage.counts[name] ?? 0;
}

/**
 * @param {string} name     e.g. "gemini"
 * @param {{ perMinute: number, perDay: number }} limits  0 means no limit.
 */
export function createLimiter(name, { perMinute, perDay }) {
  const recent = [];
  return {
    /** Records one call and returns null, or returns why the call isn't allowed. */
    take() {
      const now = Date.now();
      while (recent.length && now - recent[0] > 60_000) recent.shift();
      if (perMinute > 0 && recent.length >= perMinute) {
        return `${name} hit its limit of ${plural(perMinute, 'call')} per minute`;
      }
      const used = usedToday(name);
      if (perDay > 0 && used >= perDay) {
        return `${name} hit its daily limit of ${plural(perDay, 'call')}`;
      }
      recent.push(now);
      usage.counts[name] = used + 1;
      save();
      return null;
    },
    stats() {
      return { perMinute, perDay, usedToday: usedToday(name) };
    },
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Reads a non-negative integer from the environment. */
export function envLimit(variable, fallback) {
  const n = Number(process.env[variable]);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
