import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { createMailer } from './mail';

// A stand-in for emailer.aceiq.ca that records what it was sent.
let server: http.Server;
let url: string;
let status = 200;
const received: { headers: http.IncomingHttpHeaders; body: Record<string, string> }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(raw) });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(status === 200 ? { message: 'Email sent successfully' } : { error: 'nope' }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/send-email`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('emailer', () => {
  it('posts the code in the shape the emailer expects', async () => {
    const config = loadConfig({
      EMAILER_URL: url,
      EMAILER_KEY: 'k3y',
      PUBLIC_URL: 'https://stalk.photo',
    });
    await createMailer(config, false).sendCode('abc1234@rit.edu', '482913');
    const { headers, body } = received.at(-1)!;
    expect(headers['authorization']).toBe('Bearer k3y');
    expect(body).toEqual({
      to_email: 'abc1234@rit.edu',
      subject: '482913 is your TheDailyStalk code',
      refer_page: 'https://stalk.photo',
      'Your sign-in code': '482913',
      'It works for': '10 minutes',
      Note: 'If you didn’t try to sign in, you can ignore this email.',
    });
  });

  it('fails loudly when the emailer does', async () => {
    status = 500;
    const mailer = createMailer(loadConfig({ EMAILER_URL: url }), false);
    await expect(mailer.sendCode('abc1234@rit.edu', '000000')).rejects.toThrow(
      /emailer answered 500/,
    );
    status = 200;
  });

  it('prints codes when no email is set up', async () => {
    const mailer = createMailer(loadConfig({}), false);
    await mailer.sendCode('abc1234@rit.edu', '123456');
    expect(mailer.outbox).toEqual([{ to: 'abc1234@rit.edu', code: '123456' }]);
  });
});
