// Passwordless sign-in: we email a 6-digit code to an RIT address, and a correct code starts a
// session. Codes (not links) because RIT mail runs through Outlook, whose link scanner would
// "click" a one-time link before the student does.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { accountEmail, emailProblem, normalizeEmail } from '../src/app/shared/rules';
import type { Config } from './config';
import { HttpError, RateLimiter, getCookie } from './http';
import type { Mailer } from './mail';
import type { Store, UserRow } from './store';

export const SESSION_COOKIE = 'stalk_session';

const CODE_TTL = 10 * 60_000;
const RESEND_AFTER = 60_000;
const MAX_ATTEMPTS = 5;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export class Auth {
  readonly limiter = new RateLimiter();

  constructor(
    private readonly config: Config,
    private readonly store: Store,
    private readonly mailer: Mailer,
  ) {}

  isAdmin(user: UserRow): boolean {
    return this.config.admins.has(user.email);
  }

  /** Emails a fresh code. Returns seconds until another can be requested. */
  async requestCode(rawEmail: unknown, ip: string, now: number): Promise<number> {
    const email = normalizeEmail(String(rawEmail ?? ''));
    const problem = emailProblem(email, this.config.emailRules);
    if (problem) throw new HttpError(400, problem);
    const account = accountEmail(email);

    if ((await this.store.userByEmail(account))?.banned) {
      throw new HttpError(403, 'This account has been banned.');
    }
    const previous = await this.store.getCode(account);
    if (previous && now - previous.sent_at < RESEND_AFTER) {
      throw new HttpError(429, 'We just sent you a code. Wait a minute before asking for another.');
    }
    if (
      !this.limiter.take(`send-ip:${ip}`, 20, HOUR, now) ||
      !this.limiter.take(`send:${account}`, 6, HOUR, now)
    ) {
      throw new HttpError(429, 'Too many codes. Try again in a bit.');
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(16).toString('hex');
    await this.store.saveCode({
      email: account,
      salt,
      hash: sha256(salt + code),
      sent_at: now,
      expires_at: now + CODE_TTL,
    });
    try {
      await this.mailer.sendCode(email, code);
    } catch (error) {
      await this.store.deleteCode(account);
      console.error('[mail] send failed:', error);
      throw new HttpError(502, "We couldn't send the email. Try again soon.");
    }
    return RESEND_AFTER / 1000;
  }

  /** Checks a code. On success returns the user (created on first sign-in) and a session token. */
  async verifyCode(
    rawEmail: unknown,
    rawCode: unknown,
    ip: string,
    now: number,
  ): Promise<{ user: UserRow; token: string }> {
    const account = accountEmail(normalizeEmail(String(rawEmail ?? '')));
    const code = String(rawCode ?? '').replace(/\D/g, '');
    if (!this.limiter.take(`verify-ip:${ip}`, 60, HOUR, now)) {
      throw new HttpError(429, 'Too many tries. Try again in a bit.');
    }

    const row = await this.store.getCode(account);
    if (!row || row.expires_at <= now) {
      throw new HttpError(400, 'That code expired. Ask for a new one.');
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(400, 'Too many wrong codes. Ask for a new one.');
    }
    const expected = Buffer.from(row.hash, 'hex');
    const actual = Buffer.from(sha256(row.salt + code), 'hex');
    if (code.length !== 6 || !timingSafeEqual(expected, actual)) {
      await this.store.countCodeAttempt(account);
      throw new HttpError(400, "That code isn't right.");
    }
    await this.store.deleteCode(account);

    const user = await this.store.findOrCreateUser(account, now);
    if (user.banned) throw new HttpError(403, 'This account has been banned.');

    const token = randomBytes(32).toString('base64url');
    await this.store.createSession(
      sha256(token),
      user.id,
      now,
      now + this.config.sessionDays * DAY,
    );
    return { user, token };
  }

  /**
   * The signed-in user, if any. Sessions roll: once one is more than a day old, using the site
   * pushes its expiry out again (and refreshes the cookie), so active people stay signed in.
   */
  async userFrom(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    now: number,
  ): Promise<UserRow | null> {
    const token = getCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const hash = sha256(token);
    const user = await this.store.sessionUser(hash, now);
    if (!user || user.banned) return null;
    const fullLength = this.config.sessionDays * DAY;
    if (user.session_expires_at - now < fullLength - DAY) {
      await this.store.extendSession(hash, now + fullLength);
      res.setHeader('Set-Cookie', this.sessionCookie(token));
    }
    return user;
  }

  async signOut(req: http.IncomingMessage): Promise<void> {
    const token = getCookie(req, SESSION_COOKIE);
    if (token) await this.store.deleteSession(sha256(token));
  }

  sessionCookie(token: string | null): string {
    const parts = [
      `${SESSION_COOKIE}=${token ?? ''}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${token ? this.config.sessionDays * 86_400 : 0}`,
    ];
    if (this.config.publicUrl.startsWith('https://')) parts.push('Secure');
    return parts.join('; ');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
