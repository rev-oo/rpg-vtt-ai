import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/config/index.js';

describe('loadConfig', () => {
  it('applies defaults when nothing is set', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      dataDir: path.resolve('./data'),
      port: 3000,
      sessionTtlSeconds: 604_800,
      publicUrl: new URL('http://localhost:3000'),
      logLevel: 'info',
      trustProxy: false,
    });
  });

  it('reads and coerces every variable', () => {
    const config = loadConfig({
      DATA_DIR: '/srv/vtt',
      PORT: '8080',
      SESSION_TTL: '3600',
      PUBLIC_URL: 'https://vtt.example.com',
      LOG_LEVEL: 'debug',
      TRUST_PROXY: 'true',
    });
    expect(config).toEqual({
      dataDir: '/srv/vtt',
      port: 8080,
      sessionTtlSeconds: 3600,
      publicUrl: new URL('https://vtt.example.com'),
      logLevel: 'debug',
      trustProxy: true,
    });
  });

  it('treats empty variables as unset', () => {
    expect(loadConfig({ PORT: '', PUBLIC_URL: '' }).port).toBe(3000);
  });

  it('accepts a proxy hop count for TRUST_PROXY', () => {
    expect(loadConfig({ TRUST_PROXY: '2' }).trustProxy).toBe(2);
  });

  it('derives PUBLIC_URL from PORT when unset', () => {
    expect(loadConfig({ PORT: '4000' }).publicUrl.href).toBe('http://localhost:4000/');
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['PORT', '3.5'],
    ['SESSION_TTL', '0'],
    ['SESSION_TTL', '-5'],
    ['PUBLIC_URL', 'not a url'],
    ['PUBLIC_URL', 'ftp://example.com'],
    ['LOG_LEVEL', 'verbose'],
    ['TRUST_PROXY', 'yes'],
  ])('rejects %s=%s with a message naming the variable', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ [name]: value })).toThrow(new RegExp(`→ at ${name}`));
  });

  it('reports every invalid variable at once', () => {
    try {
      loadConfig({ PORT: 'abc', LOG_LEVEL: 'verbose' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).toMatch(/PORT[\s\S]*LOG_LEVEL|LOG_LEVEL[\s\S]*PORT/);
    }
  });
});
