import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ArchiveError,
  MAX_TEXT_BYTES,
  pluginFolderOf,
  readPluginArchive,
  readPluginFolder,
  writeZip,
} from '../src/index.js';

const text = (value: string) => Buffer.from(value, 'utf8');

describe('readPluginArchive (ADR-026)', () => {
  it('reads files at the root, without dot files and node_modules', () => {
    const files = readPluginArchive(
      writeZip([
        ['plugin.json', text('{}')],
        ['styles/sheet.css', text('a{}')],
        ['.DS_Store', text('x')],
        ['code/node_modules/x.js', text('x')],
      ]),
    );
    expect([...files.keys()]).toEqual(['plugin.json', 'styles/sheet.css']);
  });

  it('drops a single top-level folder', () => {
    const files = readPluginArchive(
      writeZip([
        ['tiny/', Buffer.alloc(0)],
        ['tiny/plugin.json', text('{}')],
        ['tiny/lang/en.json', text('{}')],
      ]),
    );
    expect([...files.keys()]).toEqual(['plugin.json', 'lang/en.json']);
  });

  it('needs a manifest', () => {
    expect(() =>
      readPluginArchive(
        writeZip([
          ['a/x.json', text('{}')],
          ['b/plugin.json', text('{}')],
        ]),
      ),
    ).toThrow(ArchiveError);
  });
});

describe('plugin folders', () => {
  let dir = '';
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads text files, lists the rest, skips links and reports large files', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vtt-io-'));
    await mkdir(path.join(dir, 'styles'));
    await mkdir(path.join(dir, 'code'));
    await writeFile(path.join(dir, 'plugin.json'), '{"id":"x"}');
    await writeFile(path.join(dir, 'styles', 'a.css'), 'a{}');
    await writeFile(path.join(dir, 'code', 'client.js'), 'export default {}');
    await writeFile(path.join(dir, 'big.json'), 'x'.repeat(MAX_TEXT_BYTES + 1));
    await symlink('/etc/hostname', path.join(dir, 'linked.json'));

    const folder = await readPluginFolder(dir);
    expect(Object.fromEntries(folder.files)).toEqual({
      'plugin.json': '{"id":"x"}',
      'styles/a.css': 'a{}',
      'code/client.js': '',
    });
    expect(folder.issues).toMatchObject([{ code: 'file_too_large', file: 'big.json' }]);

    const same = pluginFolderOf(
      new Map([
        ['plugin.json', text('{"id":"x"}')],
        ['code/client.js', text('export default {}')],
        ['big.json', Buffer.alloc(MAX_TEXT_BYTES + 1)],
      ]),
    );
    expect(Object.fromEntries(same.files)).toEqual({
      'plugin.json': '{"id":"x"}',
      'code/client.js': '',
    });
    expect(same.issues).toMatchObject([{ code: 'file_too_large', file: 'big.json' }]);
  });
});
