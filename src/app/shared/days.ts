// Calendar days as 'YYYY-MM-DD' strings. A "day" starts at local midnight in the site's time
// zone (Rochester time by default), so everyone shares the same theme and posting window.

export const DEFAULT_TIME_ZONE = 'America/New_York';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export function isDayKey(value: string): boolean {
  if (!DAY_KEY.test(value)) return false;
  const [y, m, d] = parts(value);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The calendar day it is at `ms` in `timeZone`. */
export function dayKey(ms: number, timeZone: string): string {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return f.format(ms);
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = parts(key);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcNoon(b) - utcNoon(a)) / MS_PER_DAY);
}

/** The instant local midnight starts day `key` in `timeZone`. */
export function startOfDay(key: string, timeZone: string): number {
  const [y, m, d] = parts(key);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes so a DST change between the guess and the answer can't throw it off.
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

/** "Saturday, November 7" (style 'long') or "Sat, Nov 7" (style 'short'). */
export function formatDay(key: string, style: 'long' | 'short' = 'long'): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: style,
    month: style,
    day: 'numeric',
  }).format(utcNoon(key));
}

/**
 * How many days in a row someone has posted, counting back from today. Not having posted yet
 * today doesn't break the streak; missing yesterday does.
 */
export function streakLength(postedDays: Iterable<string>, today: string): number {
  const days = new Set(postedDays);
  let day = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split('-').map(Number);
  return [y, m, d];
}

function utcNoon(key: string): number {
  const [y, m, d] = parts(key);
  return Date.UTC(y, m - 1, d, 12);
}

/** How far the wall clock in `timeZone` is ahead of UTC at `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const get = (type: string) => Number(f.formatToParts(ms).find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(ms / 1000) * 1000;
}
