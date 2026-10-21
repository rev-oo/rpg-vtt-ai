import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ScopedCssCache } from '../src/plugins/css-cache.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vtt-css-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ScopedCssCache (T-0404)', () => {
  it('scopes a stylesheet once per content and reuses the entry', async () => {
    const cache = new ScopedCssCache(path.join(dir, 'css'));
    const first = await cache.get(
      'tiny-d20',
      'styles/sheet.css',
      'body { margin: 0 } .a { color: red }',
    );
    expect(first.css).toContain('[data-plugin="tiny-d20"] .a');
    expect(first.issues).toHaveLength(1);
    const entries = await readdir(path.join(dir, 'css'));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^[0-9a-f]{64}\.json$/);

    // The entry is read back rather than recomputed: change it on disk to tell.
    await writeFile(
      path.join(dir, 'css', entries[0] ?? ''),
      JSON.stringify({ css: 'from cache', issues: [] }),
    );
    expect(
      await cache.get('tiny-d20', 'styles/sheet.css', 'body { margin: 0 } .a { color: red }'),
    ).toEqual({
      css: 'from cache',
      issues: [],
    });
  });

  it('keys entries by plugin, file and content', async () => {
    const cache = new ScopedCssCache(path.join(dir, 'css'));
    await cache.get('a', 'styles/x.css', '.a {}');
    await cache.get('b', 'styles/x.css', '.a {}');
    await cache.get('a', 'styles/y.css', '.a {}');
    await cache.get('a', 'styles/x.css', '.b {}');
    expect(await readdir(path.join(dir, 'css'))).toHaveLength(4);
  });

  it('recomputes an entry that is corrupt', async () => {
    const cache = new ScopedCssCache(path.join(dir, 'css'));
    await cache.get('a', 'styles/x.css', '.a { color: red }');
    const [entry] = await readdir(path.join(dir, 'css'));
    await writeFile(path.join(dir, 'css', entry ?? ''), '{"css": 1}');
    expect((await cache.get('a', 'styles/x.css', '.a { color: red }')).css).toContain(
      '[data-plugin="a"] .a',
    );
  });
});
