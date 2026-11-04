import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FRAME_MODULES, framePage, framePolicy } from '../scripts/frame-page.js';

const hash = (source: string) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;

describe('the plugin frame page (T-1502)', () => {
  it('lets the frame run its scripts and data: modules, and fetch nothing', () => {
    const policy = framePolicy(['a()']).split('; ');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`script-src ${hash('a()')} data:`);
    // No connect-src, img-src from a server or frame-src: `default-src 'none'` holds.
    expect(policy.some((part) => /^(connect|frame|worker)-src/.test(part))).toBe(false);
    expect(policy).toContain('img-src data: blob:');
  });

  it('carries its policy, its import map and its script inline', async () => {
    const html = await framePage();
    const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '';
    const importMap = /<script type="importmap">([^<]*)<\/script>/.exec(html)?.[1] ?? '';
    const script = /<\/div><script>([\s\S]*)<\/script><\/body>/.exec(html)?.[1] ?? '';
    const { imports } = JSON.parse(importMap) as { imports: Record<string, string> };
    expect(Object.keys(imports)).toEqual([...FRAME_MODULES]);
    for (const url of Object.values(imports)) expect(url).toMatch(/^data:text\/javascript/);
    expect(policy).toContain(`script-src ${hash(importMap)} ${hash(script)} data:`);
    // The policy comes before any script.
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script'));
  }, 60_000);
});
