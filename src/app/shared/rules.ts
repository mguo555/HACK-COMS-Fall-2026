// Sign-up rules shared by the server and the sign-in form.

export const DEFAULT_EMAIL_DOMAINS = ['rit.edu', 'g.rit.edu'];

/** RIT usernames: initials then digits, like abc1234. Rules out aliases like first.last@rit.edu. */
export const DEFAULT_USERNAME_PATTERN = '^[a-z]{2,4}[0-9]{3,4}$';

export interface EmailRules {
  domains: string[];
  /** Applied to the part before the @ (ignoring +tags). Null allows any username. */
  username: RegExp | null;
}

export const DEFAULT_EMAIL_RULES: EmailRules = {
  domains: DEFAULT_EMAIL_DOMAINS,
  username: new RegExp(DEFAULT_USERNAME_PATTERN),
};

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Why an email can't be used to sign up, or null if it's fine. Expects a normalized email. */
export function emailProblem(email: string, rules: EmailRules): string | null {
  const match = /^([a-z0-9._%+-]+)@([a-z0-9.-]+)$/.exec(email);
  if (!match) return "That doesn't look like an email address.";
  if (!rules.domains.includes(match[2])) return 'Use your RIT email. It ends in @rit.edu.';
  const username = match[1].split('+')[0];
  if (rules.username && !rules.username.test(username)) {
    return 'Use the email with your RIT username, like abc1234@rit.edu.';
  }
  return null;
}

/**
 * The address an account is stored under. abc1234+x@rit.edu and abc1234@g.rit.edu reach the same
 * inbox as abc1234@rit.edu, so they all map to one account.
 */
export function accountEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const username = email.slice(0, at).split('+')[0];
  const domain = email.slice(at + 1);
  return `${username}@${domain === 'g.rit.edu' ? 'rit.edu' : domain}`;
}

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

const RESERVED_HANDLES = new Set([
  'admin',
  'administrator',
  'api',
  'dailystalk',
  'help',
  'me',
  'mod',
  'moderator',
  'mods',
  'null',
  'official',
  'rit',
  'root',
  'stalk',
  'staff',
  'support',
  'system',
  'thedailystalk',
  'undefined',
]);

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/** Why a handle can't be used, or null if it's fine. Expects a normalized handle. */
export function handleProblem(handle: string): string | null {
  if (handle.length < HANDLE_MIN) return `At least ${HANDLE_MIN} characters.`;
  if (handle.length > HANDLE_MAX) return `${HANDLE_MAX} characters max.`;
  if (!/^[a-z0-9_]+$/.test(handle)) return 'Letters, numbers and underscores only.';
  if (RESERVED_HANDLES.has(handle)) return 'That name is taken.';
  return null;
}
