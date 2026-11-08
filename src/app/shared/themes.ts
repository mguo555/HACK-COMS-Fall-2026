// The daily theme list. Day one (THEME_START) gets the first theme, the next day the second,
// and so on, wrapping around at the end. PINNED overrides the rotation for specific dates.
//
// Editing is safe: once a day starts, the server saves its theme in the database, so changing
// this list only affects days that haven't happened yet.
import { daysBetween } from './days';

export const THEME_START = '2026-11-07';

export const THEMES: readonly string[] = [
  'something green',
  'out your window',
  'brick',
  'your desk right now',
  'something orange',
  'leaves',
  "what you're eating",
  'a shadow',
  'tiny things',
  'the sky',
  'your shoes',
  'a sign',
  'something old',
  'a houseplant',
  'where you study',
  'reflections',
  'something round',
  'your walk to class',
  'texture',
  'your drink of choice',
  'something red',
  'a door',
  'golden hour',
  'moss',
  'stairs',
  'your favorite spot on campus',
  'a mess',
  'something you made',
  'lights at night',
  'a tree',
  'lines',
  'a pattern',
  'something blue',
  'the weather',
  'a flower',
  'something soft',
  'pairs',
  'a corner',
  'hands',
  'something cold',
  'dinner',
  'a bike',
  'symmetry',
  'clouds',
  'something yellow',
  'the floor',
  'a mug',
  'roots',
  'weeds',
  'a sticker',
  'a vending machine',
  'sunrise',
  'a tiny plant',
  'an empty room',
  'the tunnels',
  "a book you're reading",
  'your bag',
  "something you can't explain",
];

export const PINNED: Readonly<Record<string, string>> = {
  '2026-11-08': 'nature on campus',
  '2026-11-26': "something you're thankful for",
  '2026-12-31': 'your last photo of the year',
  '2027-01-01': 'your first photo of the year',
  '2027-02-14': 'something you love',
  '2027-10-31': 'something spooky',
};

export function themeFor(date: string): string {
  const pinned = PINNED[date];
  if (pinned) return pinned;
  const n = THEMES.length;
  const i = daysBetween(THEME_START, date);
  return THEMES[((i % n) + n) % n];
}
