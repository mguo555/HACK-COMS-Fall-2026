// Sends sign-in codes. With SMTP set up in .env it emails them; without it (local development)
// it prints them to the server console, where only whoever runs the server can see them.
import nodemailer from 'nodemailer';
import type { Config } from './config';

export interface Mailer {
  sendCode(to: string, code: string): Promise<void>;
  /** Codes "sent" without SMTP, newest last. Used by tests. */
  readonly outbox: { to: string; code: string }[];
}

export function createMailer(config: Config, log = true): Mailer {
  const outbox: { to: string; code: string }[] = [];
  const smtp = config.smtp;

  if (!smtp) {
    return {
      outbox,
      async sendCode(to, code) {
        outbox.push({ to, code });
        if (outbox.length > 50) outbox.shift();
        if (log) console.log(`[mail] no SMTP set up. Sign-in code for ${to}: ${code}`);
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });

  return {
    outbox,
    async sendCode(to, code) {
      const site = config.publicUrl || 'TheDailyStalk';
      await transport.sendMail({
        from: config.mailFrom,
        to,
        subject: `${code} is your TheDailyStalk code`,
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
