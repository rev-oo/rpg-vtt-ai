import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config/index.js';
import { buildApp } from '../src/http/app.js';
import { createLogger } from '../src/logger/index.js';

import { createTestDb } from './support/db.js';
import { captureLogs } from './support/log-capture.js';

const PAGE = '<!DOCTYPE html><html><head><meta charSet="UTF-8"/></head><body></body></html>';

/** A server over a fake build: index.html, a hashed asset and a runtime shim. */
async function withWebApp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'vtt-web-'));
  writeFileSync(path.join(dir, 'index.html'), PAGE);
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'export {};');
  mkdirSync(path.join(dir, 'plugin-runtime'));
  writeFileSync(path.join(dir, 'plugin-runtime', 'react.js'), 'export {};');
  return buildApp({
    logger: createLogger('silent', captureLogs()),
    db: createTestDb(),
    config: loadConfig({}),
    webDir: dir,
  });
}

describe('the built web app (T-0703)', () => {
  it('is served with long caching only for hashed assets', async () => {
    const app = await withWebApp();
    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.headers['cache-control']).toBe('no-cache');
    expect(page.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(page.body).toBe(PAGE);

    // A reload revalidates the page; the 304 must not bring a policy meant for data.
    const etag = page.headers.etag;
    expect(etag).toBeDefined();
    for (const url of ['/', '/tables/abc']) {
      const again = await app.inject({
        method: 'GET',
        url,
        headers: { 'if-none-match': String(etag) },
      });
      expect(again.statusCode, url).toBe(304);
      expect(again.headers['content-security-policy'], url).toBeUndefined();
    }

    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const shim = await app.inject({ method: 'GET', url: '/plugin-runtime/react.js' });
    expect(shim.headers['cache-control']).toBe('no-cache');
  });

  it('answers app routes with the page, and misses elsewhere with a 404', async () => {
    const app = await withWebApp();
    for (const url of ['/tables/abc', '/invite/some-token?x=1', '/admin/settings']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).toBe(PAGE);
    }
    for (const url of ['/api/v1/nowhere', '/assets/missing.js', '/ws/other']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
    }
    expect((await app.inject({ method: 'POST', url: '/tables/abc' })).statusCode).toBe(404);
    // The API still answers as before.
    expect((await app.inject({ method: 'GET', url: '/api/v1/setup/status' })).statusCode).toBe(200);
  });
});
