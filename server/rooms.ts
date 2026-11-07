// All open tables, by room code. Rooms live in memory; idle ones are cleaned up.
import { randomInt } from 'node:crypto';
import type { RoomSettings } from '../src/app/shared/protocol';
import { Room, RoomError, normalizeSettings } from './room';

const MAX_ROOMS = 30;
const IDLE_MS = 30 * 60_000;
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O, they look like 1 and 0

const rooms = new Map<string, Room>();

export function createRoom(settings: Partial<RoomSettings> | undefined): Room {
  sweep();
  if (rooms.size >= MAX_ROOMS)
    throw new RoomError(503, 'Too many tables are open. Try again later');
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
  } while (rooms.has(code));
  const room = new Room(code, normalizeSettings(settings));
  rooms.set(code, room);
  return room;
}

export function getRoom(code: string): Room {
  const room = rooms.get(code.toUpperCase());
  if (!room) throw new RoomError(404, 'No table with that code');
  return room;
}

/** Closes tables nobody has been connected to for a while. */
export function sweep(): void {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.isEmpty && now - room.lastActivity > IDLE_MS) {
      room.close();
      rooms.delete(code);
    }
  }
}

setInterval(sweep, 5 * 60_000).unref();
