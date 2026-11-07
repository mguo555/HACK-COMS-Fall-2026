// What the bots remember about each human, saved by player name in .data/history.json
// (git-ignored) so it carries over between games and server restarts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SavedPlayer } from '../src/app/game/player-history';

const FILE = fileURLToPath(new URL('../.data/history.json', import.meta.url));
const MAX_PLAYERS = 500;

let players: Record<string, SavedPlayer> = load();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const keyFor = (name: string) => name.trim().toLowerCase();

function load(): Record<string, SavedPlayer> {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}

function scheduleSave(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, JSON.stringify(players));
    } catch (error) {
      console.warn('[history] could not save:', error instanceof Error ? error.message : error);
    }
  }, 1000);
}

export function loadPlayer(name: string): SavedPlayer | null {
  return players[keyFor(name)] ?? null;
}

export function savePlayer(name: string, data: SavedPlayer): void {
  players[keyFor(name)] = data;
  const keys = Object.keys(players);
  if (keys.length > MAX_PLAYERS) {
    // Drop the oldest entries (insertion order) so the file can't grow without bound.
    players = Object.fromEntries(keys.slice(-MAX_PLAYERS).map((k) => [k, players[k]]));
  }
  scheduleSave();
}

export function forgetPlayer(name: string): void {
  delete players[keyFor(name)];
  scheduleSave();
}
