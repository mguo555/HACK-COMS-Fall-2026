// Server settings, read once from the environment. Every value has a default that works for
// local development; .env.example documents them.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_TIME_ZONE } from '../src/app/shared/days';
import {
  DEFAULT_EMAIL_DOMAINS,
  DEFAULT_USERNAME_PATTERN,
  EmailRules,
  accountEmail,
  normalizeEmail,
} from '../src/app/shared/rules';

export interface EmailerConfig {
  /** The emailer's send endpoint, e.g. https://emailer.aceiq.ca/send-email */
  url: string;
  /** Sent as a Bearer token, for when the emailer starts checking one. */
  key: string | null;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export interface Config {
  port: number;
  host: string;
  /** Holds the uploaded photos (and the dev database when DATABASE_URL isn't set). */
  dataDir: string;
  /** Postgres connection string. Null runs PGlite in <dataDir>/pglite instead (dev and tests). */
  databaseUrl: string | null;
  timeZone: string;
  /** Where people reach the site, e.g. https://dailystalk.example. Empty in development. */
  publicUrl: string;
  emailRules: EmailRules;
  /** Account emails (see accountEmail) that can use the mod queue. */
  admins: Set<string>;
  /** How sign-in codes get emailed: the emailer service first, then SMTP. With neither, they're
   * printed to the server console. */
  emailer: EmailerConfig | null;
  smtp: SmtpConfig | null;
  mailFrom: string;
  membersOnly: boolean;
  reportsToHide: number;
  maxUploadBytes: number;
  sessionDays: number;
  /** The built Angular app to serve, if any. In development `ng serve` does this instead. */
  staticDir: string | null;
  /** Trust X-Forwarded-For for client IPs (rate limits). Only behind a reverse proxy. */
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const value = (name: string) => env[name]?.trim() || undefined;
  const list = (name: string) =>
    value(name)
      ?.split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

  const smtpHost = value('SMTP_HOST');
  const smtpPort = Number(value('SMTP_PORT')) || 587;
  const smtp: SmtpConfig | null = smtpHost
    ? {
        host: smtpHost,
        port: smtpPort,
        secure: value('SMTP_SECURE') ? value('SMTP_SECURE') === 'true' : smtpPort === 465,
        user: value('SMTP_USER') ?? '',
        pass: env['SMTP_PASS'] ?? '',
      }
    : null;

  // An empty EMAIL_USERNAME_PATTERN= line turns the username check off.
  const usernamePattern =
    env['EMAIL_USERNAME_PATTERN'] === undefined
      ? DEFAULT_USERNAME_PATTERN
      : env['EMAIL_USERNAME_PATTERN'].trim();

  const staticDir = path.resolve(value('STATIC_DIR') ?? 'dist/daily-stalk/browser');

  return {
    port: Number(value('PORT')) || 3001,
    // Loopback only by default. Set HOST=0.0.0.0 behind a reverse proxy.
    host: value('HOST') ?? '127.0.0.1',
    dataDir: path.resolve(value('DATA_DIR') ?? '.data'),
    databaseUrl: value('DATABASE_URL') ?? null,
    timeZone: value('TIME_ZONE') ?? DEFAULT_TIME_ZONE,
    publicUrl: (value('PUBLIC_URL') ?? '').replace(/\/$/, ''),
    emailRules: {
      domains: list('EMAIL_DOMAINS') ?? DEFAULT_EMAIL_DOMAINS,
      username: usernamePattern ? new RegExp(usernamePattern) : null,
    },
    admins: new Set((list('ADMIN_EMAILS') ?? []).map((e) => accountEmail(normalizeEmail(e)))),
    emailer: value('EMAILER_URL')
      ? { url: value('EMAILER_URL')!, key: value('EMAILER_KEY') ?? null }
      : null,
    smtp,
    mailFrom: value('MAIL_FROM') ?? `TheDailyStalk <${smtp?.user || 'no-reply@localhost'}>`,
    membersOnly: value('MEMBERS_ONLY') !== 'false',
    reportsToHide: Number(value('REPORTS_TO_HIDE')) || 3,
    maxUploadBytes: (Number(value('MAX_UPLOAD_MB')) || 15) * 1024 * 1024,
    sessionDays: Number(value('SESSION_DAYS')) || 30,
    staticDir: existsSync(path.join(staticDir, 'index.html')) ? staticDir : null,
    trustProxy: value('TRUST_PROXY') === 'true',
  };
}
