import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { withContentSecurityPolicy } from '../scripts/content-security-policy.js';

const hash = (source: string) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`;

const policyOf = (html: string) =>
  /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/>/.exec(html)?.[1] ?? '';

describe('the page policy (T-0701)', () => {
  const page =
    '<!DOCTYPE html><html><head><meta charSet="UTF-8"/><title>VTT</title>' +
    '<script type="importmap">{"imports":{}}</script></head><body>' +
    '<script>window.a = 1;</script><script type="module" src="/assets/app.js"></script>' +
    '</body></html>';

  it('allows exactly the inline scripts of the page', () => {
    const policy = policyOf(withContentSecurityPolicy(page));
    const scripts = policy.split('; ').find((part) => part.startsWith('script-src '));
    expect(scripts).toBe(`script-src 'self' ${hash('{"imports":{}}')} ${hash('window.a = 1;')}`);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
  });

  it('comes right after the charset, before any script', () => {
    const html = withContentSecurityPolicy(page);
    expect(html.indexOf('<meta charSet="UTF-8"/><meta http-equiv="Content-Security-Policy"')).toBe(
      html.indexOf('<meta charSet'),
    );
  });

  it('is added once', () => {
    expect(() => withContentSecurityPolicy(withContentSecurityPolicy(page))).toThrow();
  });
});
