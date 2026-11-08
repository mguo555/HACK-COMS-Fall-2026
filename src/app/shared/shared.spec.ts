import { describe, expect, it } from 'vitest';
import { addDays, dayKey, daysBetween, formatDay, isDayKey, startOfDay, streakLength } from './days';
import { DEFAULT_EMAIL_RULES, accountEmail, emailProblem, handleProblem, normalizeHandle } from './rules';
import { PINNED, THEMES, THEME_START, themeFor } from './themes';

const NY = 'America/New_York';

describe('days', () => {
  it('uses Rochester time for the day', () => {
    // 11:30pm in Rochester is already the next day in UTC.
    expect(dayKey(Date.parse('2026-11-08T04:30:00Z'), NY)).toBe('2026-11-07');
    expect(dayKey(Date.parse('2026-11-08T05:00:00Z'), NY)).toBe('2026-11-08');
  });

  it('finds local midnight, including around daylight saving changes', () => {
    expect(startOfDay('2026-11-08', NY)).toBe(Date.parse('2026-11-08T05:00:00Z'));
    expect(startOfDay('2026-11-01', NY)).toBe(Date.parse('2026-11-01T04:00:00Z')); // DST ends at 2am
    expect(startOfDay('2026-11-02', NY)).toBe(Date.parse('2026-11-02T05:00:00Z'));
    expect(startOfDay('2027-03-14', NY)).toBe(Date.parse('2027-03-14T05:00:00Z')); // DST starts at 2am
    expect(startOfDay('2027-03-15', NY)).toBe(Date.parse('2027-03-15T04:00:00Z'));
  });

  it('does calendar math', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(daysBetween('2026-11-07', '2027-11-07')).toBe(365);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-11-07')).toBe(true);
    expect(formatDay('2026-11-07')).toBe('Saturday, November 7');
    expect(formatDay('2026-11-07', 'short')).toBe('Sat, Nov 7');
  });

  it('counts streaks', () => {
    const days = ['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-06'];
    expect(streakLength(days, '2026-11-10')).toBe(3);
    expect(streakLength(days, '2026-11-11')).toBe(3); // not posted yet today
    expect(streakLength(days, '2026-11-12')).toBe(0);
    expect(streakLength([], '2026-11-12')).toBe(0);
  });
});

describe('themes', () => {
  it('starts at the top of the list and wraps around', () => {
    expect(themeFor(THEME_START)).toBe(THEMES[0]);
    expect(themeFor(addDays(THEME_START, 1))).toBe(THEMES[1]);
    expect(themeFor(addDays(THEME_START, THEMES.length + 2))).toBe(THEMES[2]);
    expect(themeFor(addDays(THEME_START, -1))).toBe(THEMES.at(-1));
  });

  it('uses pinned themes on their day', () => {
    for (const [date, theme] of Object.entries(PINNED)) expect(themeFor(date)).toBe(theme);
  });

  it('has no repeats or dashes', () => {
    expect(new Set(THEMES).size).toBe(THEMES.length);
    for (const theme of [...THEMES, ...Object.values(PINNED)]) expect(theme).not.toMatch(/[–—]/);
  });
});

describe('rules', () => {
  it('accepts RIT username emails only', () => {
    expect(emailProblem('abc1234@rit.edu', DEFAULT_EMAIL_RULES)).toBeNull();
    expect(emailProblem('abc1234@g.rit.edu', DEFAULT_EMAIL_RULES)).toBeNull();
    expect(emailProblem('abc1234+pics@rit.edu', DEFAULT_EMAIL_RULES)).toBeNull();
    expect(emailProblem('abc1234@gmail.com', DEFAULT_EMAIL_RULES)).toMatch(/RIT email/);
    expect(emailProblem('jane.doe@rit.edu', DEFAULT_EMAIL_RULES)).toMatch(/username/);
    expect(emailProblem('nope', DEFAULT_EMAIL_RULES)).toMatch(/email address/);
  });

  it('maps aliases to one account', () => {
    expect(accountEmail('abc1234+pics@g.rit.edu')).toBe('abc1234@rit.edu');
    expect(accountEmail('abc1234@rit.edu')).toBe('abc1234@rit.edu');
  });

  it('checks handles', () => {
    expect(normalizeHandle(' @Fern_42 ')).toBe('fern_42');
    expect(handleProblem('fern_42')).toBeNull();
    expect(handleProblem('ab')).toMatch(/3/);
    expect(handleProblem('fern!')).toMatch(/Letters/);
    expect(handleProblem('admin')).toMatch(/taken/);
  });
});
