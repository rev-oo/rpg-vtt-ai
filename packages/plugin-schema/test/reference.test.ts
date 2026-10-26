import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { PLUGIN_FILES, pluginReference } from '../src/index.js';

const reference = pluginReference();

describe('plugin file reference', () => {
  it('docs/plugin-reference.md matches the schemas (run `pnpm build`)', async () => {
    const committed = await readFile(
      new URL('../../../docs/plugin-reference.md', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(reference);
  });

  it('has a section for every file kind', () => {
    for (const { title } of Object.values(PLUGIN_FILES)) expect(reference).toContain(`## ${title}`);
  });

  it('links only to anchors it defines', () => {
    const anchors = new Set([...reference.matchAll(/<a id="([^"]+)"><\/a>/g)].map(([, id]) => id));
    const targets = [...reference.matchAll(/\]\(#([^)]+)\)/g)].map(([, id]) => id);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((id) => !anchors.has(id))).toEqual([]);
  });

  it('names every sheet node and setting type', () => {
    for (const node of ['row', 'tabs', 'field', 'list', 'rollButton', 'derived', 'text'])
      expect(reference).toContain(`### Node \`${node}\``);
    expect(reference).toContain('### Node `custom:<name>`');
    for (const type of ['boolean', 'integer', 'number', 'string'])
      expect(reference).toContain(`### Setting \`${type}\``);
  });
});
