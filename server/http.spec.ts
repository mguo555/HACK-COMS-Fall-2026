import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientIp } from './http';

function request(headers: Record<string, string>): http.IncomingMessage {
  return { headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as http.IncomingMessage;
}

describe('clientIp', () => {
  it('uses the socket address unless told to trust a proxy', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '1.2.3.4' }), false)).toBe('127.0.0.1');
  });

  it("prefers Cloudflare's visitor address, then X-Forwarded-For", () => {
    const both = { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8, 10.0.0.1' };
    expect(clientIp(request(both), true)).toBe('1.2.3.4');
    expect(clientIp(request({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }), true)).toBe('5.6.7.8');
    expect(clientIp(request({}), true)).toBe('127.0.0.1');
  });
});
