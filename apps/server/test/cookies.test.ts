import fastifyCookie from '@fastify/cookie';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  clearedSessionCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../src/http/cookies.js';

async function setCookieHeader(publicUrl: string, clear = false): Promise<string> {
  const app = Fastify();
  await app.register(fastifyCookie);
  const url = new URL(publicUrl);
  app.get('/', (_req, reply) => {
    if (clear) {
      reply.clearCookie(SESSION_COOKIE, clearedSessionCookieOptions(url));
    } else {
      reply.setCookie(SESSION_COOKIE, 'tok', sessionCookieOptions(url, new Date('2030-01-01')));
    }
    return reply.send();
  });
  const res = await app.inject({ method: 'GET', url: '/' });
  return String(res.headers['set-cookie']);
}

describe('session cookie', () => {
  it('is HTTP-only, SameSite=Lax, site-wide, with an expiry', async () => {
    const header = await setCookieHeader('http://localhost:3000');
    expect(header).toMatch(/^vtt_session=tok;/);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Expires=Tue, 01 Jan 2030 00:00:00 GMT');
    expect(header).not.toContain('Secure');
  });

  it('is Secure when served over HTTPS', async () => {
    expect(await setCookieHeader('https://vtt.example.com')).toContain('Secure');
  });

  it('is cleared with matching attributes', async () => {
    const header = await setCookieHeader('https://vtt.example.com', true);
    expect(header).toMatch(/^vtt_session=;/);
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
  });
});
