import { describe, expect, it } from 'vitest';

import { themeCss, themeSchema } from '../src/index.js';

describe('themeSchema (T-1602, ADR-076)', () => {
  it('accepts colours, fonts, a radius and files', () => {
    const theme = {
      light: { canvas: '#f4ecd8', primary: 'rgb(120 60 20)', fg: 'saddlebrown' },
      dark: { canvas: 'oklch(0.2 0.02 60)' },
      font: '"IM Fell English", Georgia, serif',
      radius: '0.125rem',
      fonts: [{ family: 'IM Fell English', src: 'fonts/fell.woff2', weight: '400' }],
      background: 'images/paper.webp',
    };
    expect(themeSchema.parse(theme)).toEqual(theme);
  });

  it.each([
    ['a colour that ends its declaration', { light: { canvas: 'red; color: blue' } }],
    ['a colour with a URL', { light: { canvas: 'url(x.png)' } }],
    ['an unknown token', { light: { shadow: '#000' } }],
    ['a font list with braces', { font: 'serif } body { color: red' }],
    ['a radius in other units', { radius: '1vw' }],
    ['a file outside the module', { background: '../secret.png' }],
    ['an absolute file', { background: '/etc/a.png' }],
    ['a font file with quotes', { fonts: [{ family: 'A', src: 'a".woff2' }] }],
  ])('refuses %s', (_, theme) => {
    expect(themeSchema.safeParse(theme).success).toBe(false);
  });
});

describe('themeCss', () => {
  it('sets the tokens on the page while the module is on, by colour scheme', () => {
    const css = themeCss(
      {
        light: { canvas: '#f4ecd8', primaryHover: '#7a3b12' },
        dark: { canvas: '#1d1a14' },
        font: 'Georgia, serif',
        radius: '0',
        fonts: [{ family: 'Fell', src: 'fonts/my fell.woff2', style: 'italic' }],
        background: 'images/paper.webp',
      },
      'skin',
    );
    const root = ':root[data-vtt-modules~="skin"]';
    expect(css).toContain(
      '@font-face {\n  font-family: "Fell";\n  src: url("/plugins/skin/fonts/my%20fell.woff2");',
    );
    expect(css).toContain(
      `${root} {\n  --font-sans: Georgia, serif;\n  --radius-xs: calc(0 * 0.25);`,
    );
    expect(css).toContain(
      `@media not (prefers-color-scheme: dark) {\n${root} {\n  --color-canvas: #f4ecd8;\n  --color-primary-hover: #7a3b12;\n}\n}`,
    );
    expect(css).toContain(
      `@media (prefers-color-scheme: dark) {\n${root} {\n  --color-canvas: #1d1a14;\n}\n}`,
    );
    expect(css).toContain(
      `${root} [data-vtt-part="table"] {\n  background-image: url("/plugins/skin/images/paper.webp");`,
    );
  });

  it('is empty for an empty theme', () => {
    expect(themeCss({}, 'skin')).toBe('\n');
  });
});
