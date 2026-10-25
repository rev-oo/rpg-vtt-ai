import { describe, expect, it } from 'vitest';

import { REQUEST_ID_HEADER } from '../src/http/app.js';
import { createLogger } from '../src/logger/index.js';

import { createTestApp } from './support/app.js';
import { captureLogs } from './support/log-capture.js';

async function setup() {
  const { app, logs } = await createTestApp();
  app.get('/ping', () => ({ ok: true }));
  return { app, logs };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request ids', () => {
  it('generates a request id, returns it and logs it', async () => {
    const { app, logs } = await setup();
    const res = await app.inject({ method: 'GET', url: '/ping' });

    const id = res.headers[REQUEST_ID_HEADER];
    expect(id).toMatch(UUID);
    const requestLogs = logs.lines.filter((line) => line.requestId === id);
    expect(requestLogs.map((line) => line.msg)).toEqual(['incoming request', 'request completed']);
  });

  it('reuses a safe incoming request id', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { [REQUEST_ID_HEADER]: 'proxy-abc.123' },
    });
    expect(res.headers[REQUEST_ID_HEADER]).toBe('proxy-abc.123');
  });

  it.each(['has spaces', 'x'.repeat(129), 'quote"inject'])(
    'replaces an unsafe incoming request id (%s)',
    async (incoming) => {
      const { app } = await setup();
      const res = await app.inject({
        method: 'GET',
        url: '/ping',
        headers: { [REQUEST_ID_HEADER]: incoming },
      });
      expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID);
    },
  );

  it('sets the request id on 404 responses too', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'GET', url: '/missing' });
    expect(res.statusCode).toBe(404);
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(UUID);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
  });
});

describe('logger', () => {
  it('writes structured JSON and redacts credentials', () => {
    const logs = captureLogs();
    createLogger('info', logs).info(
      { res: { headers: { 'set-cookie': 'sid=secret' } }, secret: 'kept' },
      'hi',
    );

    const line = logs.lines.find((l) => l.msg === 'hi');
    expect(line).toMatchObject({
      level: 30,
      service: 'vtt-server',
      res: { headers: { 'set-cookie': '[redacted]' } },
    });
    expect(typeof line?.time).toBe('string');
  });

  it('logs requests without headers or invite tokens (T-0701)', async () => {
    const { app, logs } = await createTestApp();
    const token = 'a'.repeat(43);
    await app.inject({
      method: 'GET',
      url: `/api/v1/invites/${token}`,
      headers: { cookie: 'vtt_session=secret' },
    });

    const incoming = logs.lines.find((l) => l.msg === 'incoming request');
    expect(incoming?.req).toEqual({
      method: 'GET',
      url: '/api/v1/invites/[redacted]',
      host: 'localhost:80',
      remoteAddress: '127.0.0.1',
    });
    const all = JSON.stringify(logs.lines);
    expect(all).not.toContain(token);
    expect(all).not.toContain('secret');
  });
});
