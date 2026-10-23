import { describe, expect, it } from 'vitest';

import { createTestApp } from './support/app.js';

const COMMON = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
};

describe('security headers (T-0701)', () => {
  it('are on every API answer, errors included', async () => {
    const t = await createTestApp();
    for (const url of ['/api/v1/setup/status', '/api/v1/me', '/api/v1/nowhere']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.headers).toMatchObject({
        ...COMMON,
        'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      });
    }
  });

  it('leave a page its own policy, and forbid framing it', async () => {
    const t = await createTestApp();
    t.app.get('/page', (_request, reply) => reply.type('text/html').send('<!DOCTYPE html>'));
    const res = await t.app.inject({ method: 'GET', url: '/page' });
    expect(res.headers).toMatchObject({
      ...COMMON,
      'content-security-policy': "frame-ancestors 'none'",
    });
  });
});
