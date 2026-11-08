// Sends sign-in codes, whichever way .env sets up:
// - EMAILER_URL: POST to the team's emailer service (emailer.aceiq.ca), which sends from Gmail.
// - SMTP_HOST: straight over SMTP.
// - neither (local development): print the code to the server console, where only whoever runs
//   the server can see it.
import nodemailer from 'nodemailer';
import type { Config, EmailerConfig } from './config';

export interface Mailer {
  sendCode(to: string, code: string): Promise<void>;
  /** Codes "sent" without a real mail setup, newest last. Used by tests. */
  readonly outbox: { to: string; code: string }[];
}

export function createMailer(config: Config, log = true): Mailer {
  const outbox: { to: string; code: string }[] = [];
  const site = config.publicUrl || 'TheDailyStalk';
  const subject = (code: string) => `${code} is your TheDailyStalk code`;

  if (config.emailer) {
    const emailer = config.emailer;
    return {
      outbox,
      sendCode: (to, code) => sendWithEmailer(emailer, to, subject(code), code, site),
    };
  }

  const smtp = config.smtp;
  if (smtp) {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    });
    return {
      outbox,
      async sendCode(to, code) {
        await transport.sendMail({
          from: config.mailFrom,
          to,
          subject: subject(code),
          text: [
            `Your sign-in code is ${code}`,
            '',
            'It works for 10 minutes. If you didn’t try to sign in, you can ignore this email.',
            '',
            site,
          ].join('\n'),
        });
      },
    };
  }

  return {
    outbox,
    async sendCode(to, code) {
      outbox.push({ to, code });
      if (outbox.length > 50) outbox.shift();
      if (log) console.log(`[mail] no email set up. Sign-in code for ${to}: ${code}`);
    },
  };
}

/**
 * The emailer takes JSON with to_email, subject and refer_page, and writes every other field into
 * the body as a "name: value" line, under a "Refer Page: ..." line. So the email reads:
 *
 *   Refer Page: https://stalk.photo
 *
 *   Your sign-in code: 482913
 *   It works for: 10 minutes
 *   Note: If you didn’t try to sign in, you can ignore this email.
 */
async function sendWithEmailer(
  emailer: EmailerConfig,
  to: string,
  subject: string,
  code: string,
  site: string,
): Promise<void> {
  const res = await fetch(emailer.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(emailer.key ? { Authorization: `Bearer ${emailer.key}` } : {}),
    },
    body: JSON.stringify({
      to_email: to,
      subject,
      refer_page: site,
      'Your sign-in code': code,
      'It works for': '10 minutes',
      Note: 'If you didn’t try to sign in, you can ignore this email.',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`emailer answered ${res.status}: ${detail}`);
  }
}
