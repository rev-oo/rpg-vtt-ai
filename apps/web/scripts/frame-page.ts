// Builds the page each plugin frame loads (T-1502, ADR-074): one self-contained HTML file with
// React, the SDK and the frame's half of the bridge inline, an import map that lets plugin
// code import those by name, and a policy that allows those scripts, plugin code given as a
// `data:` module, and no network at all. `vite.config.ts` serves it in dev and emits it in
// the build.
import { createHash } from 'node:crypto';
import path from 'node:path';

import { rolldown } from 'rolldown';

import { FRAME_RUNTIME_GLOBAL } from '../src/plugin-host/frame-protocol.js';

/** The modules plugin client code imports by name (specs §8.10, ADR-025). */
export const FRAME_MODULES = ['react', 'react/jsx-runtime', '@vtt/sdk/client'] as const;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ENTRY = path.join(import.meta.dirname, '../src/plugin-frame/frame.tsx');

/** A module that re-exports one shared module from the frame's global, as a `data:` URL. */
async function shim(specifier: string): Promise<string> {
  const exported = (await import(specifier)) as Record<string, unknown>;
  const names = Object.keys(exported).filter((name) => name !== 'default' && IDENTIFIER.test(name));
  const source = [
    `const m = globalThis[${JSON.stringify(FRAME_RUNTIME_GLOBAL)}][${JSON.stringify(specifier)}];`,
    'export default m.default ?? m;',
    `export const { ${names.join(', ')} } = m;`,
  ].join('\n');
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
}

/** The frame's script: React, the SDK and the bridge, as one classic script. */
async function frameScript(): Promise<string> {
  const bundle = await rolldown({
    input: ENTRY,
    platform: 'browser',
    resolve: { extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
    transform: {
      jsx: 'react-jsx',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    },
  });
  try {
    const { output } = await bundle.generate({
      format: 'iife',
      minify: true,
      codeSplitting: false,
    });
    const [chunk] = output;
    // `</script` would end the inline script early.
    return chunk.code.replaceAll('</script', '<\\/script');
  } finally {
    await bundle.close();
  }
}

const hash = (source: string): string =>
  `'sha256-${createHash('sha256').update(source).digest('base64')}'`;

/** The frame's policy: its two inline scripts and `data:` modules run; nothing is fetched. */
export function framePolicy(inlineScripts: readonly string[]): string {
  return [
    "default-src 'none'",
    ['script-src', ...inlineScripts.map(hash), 'data:'].join(' '),
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The frame page's HTML. */
export async function framePage(): Promise<string> {
  const imports = Object.fromEntries(
    await Promise.all(FRAME_MODULES.map(async (name) => [name, await shim(name)] as const)),
  );
  const importMap = JSON.stringify({ imports });
  const script = await frameScript();
  const policy = framePolicy([importMap, script]);
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>html,body{margin:0;background:transparent}</style>',
    `<script type="importmap">${importMap}</script>`,
    '</head><body><div id="root"></div>',
    `<script>${script}</script>`,
    '</body></html>',
    '',
  ].join('');
}
