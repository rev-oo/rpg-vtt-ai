import { describe, expect, it } from 'vitest';

import { MAX_CSS_BYTES, scopeCss, scopePluginCss, type PluginIssue } from '../src/index.js';

const options = { pluginId: 'tiny-d20', file: 'styles/sheet.css' };
const SCOPE = '[data-plugin="tiny-d20"]';

/** The scoped CSS without the wrapper, one rule per line. */
function scoped(source: string) {
  const { css, issues } = scopeCss(source, options);
  const body = css
    .replace(/^@layer plugin \{/, '')
    .replace(/\}\n\[data-plugin="tiny-d20"\] \{ contain: layout paint; \}$/, '');
  return {
    rules: body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    stripped: issues.map((issue) => `${String(issue.params.rule)} @${String(issue.params.line)}`),
    issues,
  };
}

describe('scopeCss (specs §8.6)', () => {
  it('wraps everything in @layer plugin and contains the sheet root outside it', () => {
    const { css, issues } = scopeCss('.a { color: red }', options);
    expect(css).toBe(
      `@layer plugin {${SCOPE} .a { color: red }\n}\n${SCOPE} { contain: layout paint; }`,
    );
    expect(issues).toEqual([]);
  });

  it('prefixes every selector, including inside @media, @supports and @container', () => {
    const { rules } = scoped(
      [
        '.vitals > .hp, .a:is(.b, .c) { display: flex }',
        '* { box-sizing: border-box }',
        '@media (min-width: 40rem) { .grid { gap: 1rem } }',
        '@supports (display: grid) { .grid { display: grid } }',
        '@container (width > 20rem) { .card { padding: 0 } }',
      ].join('\n'),
    );
    expect(rules).toEqual([
      `${SCOPE} .vitals > .hp,${SCOPE} .a:is(.b, .c) { display: flex }`,
      `${SCOPE} * { box-sizing: border-box }`,
      `@media (min-width: 40rem) { ${SCOPE} .grid { gap: 1rem } }`,
      `@supports (display: grid) { ${SCOPE} .grid { display: grid } }`,
      `@container (width > 20rem) { ${SCOPE} .card { padding: 0 } }`,
    ]);
  });

  it('rewrites :root to the scope, so tokens are overridden locally', () => {
    const { rules } = scoped(
      ':root { --vtt-accent: #8a2be2 }\n:root.dark .x { color: white }\n:not(:root) .y { color: red }',
    );
    expect(rules).toEqual([
      `${SCOPE} { --vtt-accent: #8a2be2 }`,
      `${SCOPE}.dark .x { color: white }`,
      `${SCOPE} :not(${SCOPE}) .y { color: red }`,
    ]);
  });

  it('removes @import and unsupported at-rules with a warning, and @charset silently', () => {
    const { rules, stripped } = scoped(
      "@charset 'utf-8';\n@import url('theme.css');\n@page { margin: 0 }\n@property --x { syntax: '*' }\n.a { color: red }",
    );
    expect(rules).toEqual([`${SCOPE} .a { color: red }`]);
    expect(stripped).toEqual(['@import @2', '@page @3', '@property @4']);
  });

  it('strips selectors on the document and z-index on :root', () => {
    const { rules, stripped } = scoped(
      'html, body .y { position: fixed }\nbody { margin: 0 }\n.ok, BODY { color: red }\n:root { --a: 1; z-index: 10 }',
    );
    expect(rules).toEqual([`${SCOPE} .ok { color: red }`, `${SCOPE} { --a: 1 }`]);
    expect(stripped).toEqual([
      'html @1',
      'body .y @1',
      'body @2',
      'BODY @3',
      ':root { z-index } @4',
    ]);
  });

  it('prefixes keyframe names and the animations that use them', () => {
    const { rules } = scoped(
      '@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }\n.a { animation: pulse 1s infinite, spin 2s }\n.b { animation-name: pulse }',
    );
    expect(rules).toEqual([
      '@keyframes tiny-d20--pulse { from { opacity: 0 } to { opacity: 1 } }',
      `${SCOPE} .a { animation: tiny-d20--pulse 1s infinite, spin 2s }`,
      `${SCOPE} .b { animation-name: tiny-d20--pulse }`,
    ]);
  });

  it('points relative URLs into the plugin and removes external ones', () => {
    const { rules, stripped } = scoped(
      [
        '.a { background: url(../img/bg.png?v=1#x) }',
        '.b { background: url("icons/a b.svg") }',
        '.c { background-image: url(https://evil.example/x.png); color: red }',
        '.d { background: url(//cdn.example/x.png) }',
        '.e { background: url(/etc/passwd) }',
        '.f { background: url(../../secret.png) }',
        '.g { background: url(data:image/png;base64,AAAA) }',
      ].join('\n'),
    );
    expect(rules).toEqual([
      `${SCOPE} .a { background: url("/plugins/tiny-d20/img/bg.png?v=1#x") }`,
      `${SCOPE} .b { background: url("/plugins/tiny-d20/styles/icons/a%20b.svg") }`,
      `${SCOPE} .c { color: red }`,
      `${SCOPE} .g { background: url("data:image/png;base64,AAAA") }`,
    ]);
    expect(stripped).toEqual([
      'background-image: url(https://evil.example/x.png) @3',
      'background: url(//cdn.example/x.png) @4',
      'background: url(/etc/passwd) @5',
      'background: url(../../secret.png) @6',
    ]);
  });

  it('keeps @font-face only with sources inside the plugin', () => {
    const { rules } = scoped(
      "@font-face { font-family: A; src: url(https://cdn.example/a.woff2) }\n@font-face { font-family: B; src: url(../fonts/b.woff2) format('woff2') }",
    );
    expect(rules).toEqual([
      `@font-face { font-family: B; src: url("/plugins/tiny-d20/fonts/b.woff2") format('woff2') }`,
    ]);
  });

  it('refuses files over 256 KB and files that do not parse', () => {
    const big = `.a { content: "${'x'.repeat(MAX_CSS_BYTES)}" }`;
    expect(scopeCss(big, options)).toEqual({
      css: '',
      issues: [expect.objectContaining({ severity: 'error', code: 'css_too_large' })],
    });
    // Multi-byte characters count as bytes, not characters.
    expect(scopeCss(`/*${'é'.repeat(MAX_CSS_BYTES / 2)}*/`, options).issues[0]?.code).toBe(
      'css_too_large',
    );
    expect(scopeCss('.a {', options)).toEqual({
      css: '',
      issues: [
        {
          severity: 'error',
          code: 'css_invalid',
          file: 'styles/sheet.css',
          path: [],
          params: { detail: 'Unclosed block', line: 1, column: 1 },
        },
      ],
    });
  });

  it('is a PostCSS plugin', () => {
    const issues: PluginIssue[] = [];
    const plugin = scopePluginCss(options, (issue) => issues.push(issue));
    expect(plugin.postcssPlugin).toBe('vtt-scope-plugin-css');
  });
});
