import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seededRng } from '@vtt/formula';
import { createRules } from '@vtt/plugin-engine';

import { main } from '../src/cli.js';
import { checkPlugin } from '../src/commands/validate.js';

// T-0704: the tutorial in docs/plugin-authoring.md, followed step by step as a reader would.
// Its files are the code blocks tagged `file=<path>`; a later block replaces the file.

const GUIDE = fileURLToPath(new URL('../../../docs/plugin-authoring.md', import.meta.url));

interface Step {
  title: string;
  files: Map<string, string>;
}

/** The tutorial's steps, each with the files its blocks write. */
function tutorialSteps(guide: string): Step[] {
  const start = guide.indexOf('\n## Tutorial');
  const end = guide.indexOf('\n## ', start + 1);
  const tutorial = guide.slice(start, end < 0 ? undefined : end);
  return tutorial
    .split('\n### ')
    .slice(1)
    .map((section) => {
      const files = new Map<string, string>();
      for (const [, file, body] of section.matchAll(/^```\w+ file=(\S+)\n([\s\S]*?)^```$/gm)) {
        if (file !== undefined && body !== undefined) files.set(file, body);
      }
      return { title: section.slice(0, section.indexOf('\n')), files };
    });
}

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

let temp = '';
let steps: Step[] = [];
beforeAll(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-tutorial-'));
  steps = tutorialSteps(await readFile(GUIDE, 'utf8'));
});
afterAll(async () => {
  await rm(temp, { recursive: true, force: true });
});

describe('the plugin tutorial', () => {
  const dir = () => path.join(temp, 'starter');

  it('has steps that write files', () => {
    expect(steps.length).toBeGreaterThanOrEqual(7);
    expect(steps[0]?.files.has('plugin.json')).toBe(true);
  });

  it('leaves a valid plugin, without warnings, after every step', async () => {
    for (const step of steps) {
      for (const [file, text] of step.files) {
        await mkdir(path.dirname(path.join(dir(), file)), { recursive: true });
        await writeFile(path.join(dir(), file), text);
      }
      const result = await run('validate', dir());
      expect({ step: step.title, ...result }).toMatchObject({
        step: step.title,
        code: 0,
        out: 'starter 0.1.0: valid',
      });
    }
  });

  it('ends with a plugin whose values and rolls work', async () => {
    const { plugin } = await checkPlugin(dir());
    if (!plugin) throw new Error('the tutorial plugin is not valid');
    const rules = createRules(plugin);
    const data = {
      ...rules.defaults('actor', 'hero'),
      agility: 3,
      gear: {
        a: { name: 'Rope', weight: 2, sort: 'a' },
        b: { name: 'Lamp', weight: 1, sort: 'b' },
      },
    };
    expect(rules.derived('actor', 'hero', data).values).toMatchObject({ defense: 13, load: 3 });
    const armor = [
      { type: 'armor', data: { worn: true, protection: 2 } },
      { type: 'armor', data: { worn: false, protection: 3 } },
    ];
    expect(rules.derived('actor', 'hero', data, armor).values).toMatchObject({ defense: 15 });

    const result = rules.roll('check', {
      type: 'hero',
      data,
      args: { bonus: 3 },
      rng: seededRng(1),
    });
    const total = result.roll.total;
    const expected =
      total >= 10 ? 'outcome.success' : total >= 7 ? 'outcome.partial' : 'outcome.miss';
    expect(result.outcome?.label).toBe(expected);
    expect(result.problems).toEqual([]);
  });

  it('packs', async () => {
    const out = path.join(temp, 'starter.vttplugin');
    const result = await run('pack', dir(), '--out', out);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toMatch(/^Packed starter 0\.1\.0: 9 files/);
  });
});
