import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pluginFolderOf, readZip, ARCHIVE_LIMITS } from '@vtt/plugin-io';
import { scopeCss, validatePlugin } from '@vtt/plugin-schema';

import { main } from '../src/cli.js';
import { previewModule, startDevServer } from '../src/commands/dev.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TINY_D20 = path.join(REPO, 'plugins', 'tiny-d20');
const BROKEN = path.join(REPO, 'e2e', 'fixtures', 'plugins', 'e2e-broken');
const CODED = path.join(REPO, 'e2e', 'fixtures', 'plugins', 'e2e-code');

async function run(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

let temp = '';
beforeEach(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'vtt-cli-'));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true });
});

/** The e2e-code fixture with its client code in TSX and a helper module, as authors write it. */
async function tsxPlugin(): Promise<string> {
  const dir = path.join(temp, 'source');
  await cp(CODED, dir, { recursive: true });
  await rm(path.join(dir, 'code', 'client.js'));
  await writeFile(
    path.join(dir, 'code', 'label.ts'),
    `export const label = (name: string, hp: unknown): string => \`\${name} has \${String(hp)} HP\`;\n`,
  );
  await writeFile(
    path.join(dir, 'code', 'client.tsx'),
    `import { defineClient, useActor, useField } from '@vtt/sdk/client';
import { label } from './label';

function Banner() {
  const [hp] = useField('hp');
  return <p className="banner">{label(useActor()?.name ?? '?', hp)}</p>;
}

export default defineClient({ nodes: { banner: Banner } });
`,
  );
  await writeFile(path.join(dir, '.DS_Store'), 'junk');
  await writeFile(
    path.join(dir, 'styles', 'sheet.css'),
    '.banner {\n  font-weight: bold;\n}\n\n.x { color: red }\n',
  );
  return dir;
}

describe('vtt-plugin (T-0410, §8.13)', () => {
  it('prints help and refuses bad usage', async () => {
    expect((await run('help')).out).toContain('Usage: vtt-plugin');
    expect((await run()).code).toBe(0);
    expect(await run('launch')).toMatchObject({
      code: 2,
      err: expect.stringContaining('Unknown command') as unknown,
    });
    expect((await run('validate')).code).toBe(2);
    expect((await run('validate', 'a', 'b')).code).toBe(2);
    expect((await run('--nope')).code).toBe(2);
    expect((await run('dev', '.', '--port', 'x')).code).toBe(2);
    expect((await run('validate', path.join(temp, 'missing'))).code).toBe(2);
  });

  it('validates a plugin folder as the server does', async () => {
    expect(await run('validate', TINY_D20)).toMatchObject({
      code: 0,
      out: 'tiny-d20 0.1.0: valid',
    });
    const broken = await run('validate', BROKEN);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain(
      'types/actors/hero.json $.sheet: There is no sheet named "missing"',
    );
    expect(broken.err).toContain('1 errors, 0 warnings');
  });

  it('writes the same JSON Schemas as @vtt/plugin-schema ships', async () => {
    const printed = JSON.parse((await run('schema')).out) as Record<string, unknown>;
    expect(Object.keys(printed)).toContain('plugin.schema.json');
    expect((await run('schema', '--out', temp)).code).toBe(0);
    const shipped = path.join(REPO, 'packages', 'plugin-schema', 'schemas');
    for (const name of await readdir(shipped)) {
      expect(await readFile(path.join(temp, name), 'utf8')).toBe(
        await readFile(path.join(shipped, name), 'utf8'),
      );
    }
    expect((await run('schema', 'extra')).code).toBe(2);
  });

  it('packs compiled code and minified styles into an archive the server accepts', async () => {
    const dir = await tsxPlugin();
    // An archive left in the folder by an earlier run is not packed again.
    await writeFile(path.join(dir, 'e2e-code-0.9.0.vttplugin'), 'old archive');
    const file = path.join(temp, 'out.vttplugin');
    const result = await run('pack', dir, '--out', file);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^Packed e2e-code 1\.0\.0: 8 files/);

    const files = readZip(await readFile(file), ARCHIVE_LIMITS);
    expect([...files.keys()]).toEqual([
      'cards/check.json',
      'code/client.js',
      'lang/en.json',
      'plugin.json',
      'rolls.json',
      'sheets/hero.json',
      'styles/sheet.css',
      'types/actors/hero.json',
    ]);
    const client = String(files.get('code/client.js'));
    // One module: the helper is bundled, JSX compiled, the shared modules left to the app.
    expect(client).toContain('from"react/jsx-runtime"');
    expect(client).toContain('from"@vtt/sdk/client"');
    expect(client).not.toContain('./label');
    expect(client).toContain('HP');
    const css = String(files.get('styles/sheet.css'));
    expect(css).toBe('.banner{font-weight:700}.x{color:red}');
    expect(scopeCss(css, { pluginId: 'e2e-code', file: 'styles/sheet.css' }).css).toContain(
      '[data-plugin="e2e-code"]',
    );

    const folder = pluginFolderOf(files);
    expect(validatePlugin(folder.files).issues.filter((i) => i.severity === 'error')).toEqual([]);
    // The default name is <id>-<version>.vttplugin in the working directory.
    const cwd = process.cwd();
    process.chdir(temp);
    try {
      expect((await run('pack', dir)).code).toBe(0);
      expect(await readdir(temp)).toContain('e2e-code-1.0.0.vttplugin');
    } finally {
      process.chdir(cwd);
    }
  });

  it.each(['tiny-d20', 'tiny-pool'])('validates and packs the reference plugin %s', async (id) => {
    const dir = path.join(REPO, 'plugins', id);
    expect((await run('validate', dir)).code).toBe(0);
    const file = path.join(temp, `${id}.vttplugin`);
    expect((await run('pack', dir, '--out', file)).code).toBe(0);
    const files = readZip(await readFile(file), ARCHIVE_LIMITS);
    // tiny-d20 ships its compiled hpBar node; tiny-pool has no code at all (T-0411, T-0412).
    expect([...files.keys()].filter((name) => name.startsWith('code/'))).toEqual(
      id === 'tiny-d20' ? ['code/client.js'] : [],
    );
  });

  it('refuses to pack a plugin with errors or clashing code entries', async () => {
    expect((await run('pack', BROKEN, '--out', path.join(temp, 'x.vttplugin'))).code).toBe(1);
    const dir = await tsxPlugin();
    await writeFile(path.join(dir, 'code', 'client.js'), 'export default {};');
    const clash = await run('pack', dir, '--out', path.join(temp, 'y.vttplugin'));
    expect(clash).toMatchObject({
      code: 2,
      err: expect.stringContaining('both compile to code/client.js') as unknown,
    });
  });
});

describe('vtt-plugin dev (T-0410)', () => {
  it('describes the plugin for the page, with scoped CSS and its client entry', async () => {
    const source = await previewModule(CODED);
    const data = JSON.parse(source.replace(/^export default /, '').replace(/;$/, '')) as {
      id: string;
      definition: unknown;
      css: string;
      client: string;
    };
    expect(data.id).toBe('e2e-code');
    expect(data.definition).not.toBeNull();
    expect(data.css).toContain('[data-plugin="e2e-code"]');
    expect(data.client).toBe(`/@fs/${path.join(CODED, 'code', 'client.js').replace(/^\//, '')}`);
    const broken = JSON.parse(
      (await previewModule(BROKEN)).slice('export default '.length, -1),
    ) as {
      definition: unknown;
    };
    expect(broken.definition).toBeNull();
  });

  it('serves the preview page and the plugin module', async () => {
    const server = await startDevServer(CODED, 0);
    try {
      const url = server.resolvedUrls?.local[0];
      expect(url).toBeDefined();
      const page = await fetch(String(url));
      expect(await page.text()).toContain('<div id="root"></div>');
      const module = await fetch(new URL('/@id/__x00__virtual:vtt-plugin', String(url)));
      expect(await module.text()).toContain('"id":"e2e-code"');
    } finally {
      await server.close();
    }
  }, 30_000);

  it('needs a plugin folder', async () => {
    expect((await run('dev', temp)).code).toBe(2);
  });
});
