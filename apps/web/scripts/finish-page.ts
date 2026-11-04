// Finishes the built index.html after `react-router build`: adds the page's Content Security
// Policy (T-0701), which travels with the file, whoever serves it.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const META = '<meta http-equiv="Content-Security-Policy"';
const CHARSET = /<meta charset="[^"]*"\/?>/i;

/** Where content goes right after the charset <meta>, before anything that loads. */
function afterCharset(html: string): number {
  const charset = CHARSET.exec(html);
  if (!charset) throw new Error('The page has no charset <meta>.');
  return charset.index + charset[0].length;
}

/**
 * The policy for a page whose inline scripts are `inlineScripts`. Scripts run only from this
 * origin or by hash, and WebAssembly may compile. Styles allow inline: the editor adds a <style> tag and sheets set style
 * attributes. Images may come from anywhere over HTTP(S), as actor portraits do.
 */
export function contentSecurityPolicy(inlineScripts: readonly string[]): string {
  const hashes = inlineScripts.map(
    (source) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`,
  );
  return [
    "default-src 'self'",
    // WebAssembly runs plugin shared code in QuickJS (ADR-074); it allows no JavaScript eval.
    ['script-src', "'self'", "'wasm-unsafe-eval'", ...hashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: http: data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** `html` with the policy right after its charset, before any script. */
export function withContentSecurityPolicy(html: string): string {
  if (html.includes(META)) throw new Error('The page already has a Content Security Policy.');
  const scripts = [...html.matchAll(INLINE_SCRIPT)].map((match) => match[1] ?? '');
  const meta = `${META} content="${contentSecurityPolicy(scripts)}"/>`;
  const at = afterCharset(html);
  return html.slice(0, at) + meta + html.slice(at);
}

export function finishPage(html: string): string {
  return withContentSecurityPolicy(html);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const page = new URL('../build/client/index.html', import.meta.url);
  await writeFile(page, finishPage(await readFile(page, 'utf8')));
}
