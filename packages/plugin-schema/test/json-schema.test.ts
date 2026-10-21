import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  PLUGIN_FILES,
  type PluginFileKind,
  pluginFileKind,
  pluginJsonSchema,
} from '../src/index.js';

import { committedSchema, pluginJsonFiles, REFERENCE_PLUGINS } from './support/plugins.js';

const KINDS = Object.keys(PLUGIN_FILES) as PluginFileKind[];

describe('emitted JSON Schemas', () => {
  it.each(KINDS)(
    'schemas/%s.schema.json matches the Zod source (run `pnpm build`)',
    async (kind) => {
      expect(await committedSchema(kind)).toEqual(pluginJsonSchema(kind));
    },
  );
});

describe('reference plugins', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  const validators = new Map(KINDS.map((kind) => [kind, ajv.compile(pluginJsonSchema(kind))]));

  describe.each(REFERENCE_PLUGINS)('%s', (id) => {
    it('has a known kind for every JSON file', async () => {
      const unknown = [...(await pluginJsonFiles(id)).keys()].filter(
        (path) => !pluginFileKind(path),
      );
      expect(unknown).toEqual([]);
    });

    it('passes the emitted JSON Schemas and the Zod schemas', async () => {
      const failures: Record<string, unknown> = {};
      for (const [path, data] of await pluginJsonFiles(id)) {
        const kind = pluginFileKind(path);
        if (!kind) continue;
        const validate = validators.get(kind);
        if (validate && !validate(data)) failures[`${path} (JSON Schema)`] = validate.errors;
        const parsed = PLUGIN_FILES[kind].schema.safeParse(data);
        if (!parsed.success) failures[`${path} (Zod)`] = parsed.error.issues;
      }
      expect(failures).toEqual({});
    });
  });
});

describe('pluginFileKind', () => {
  it.each([
    ['plugin.json', 'plugin'],
    ['types/actors/character.json', 'actor-type'],
    ['types/items/weapon.json', 'item-type'],
    ['sheets/character.json', 'sheet'],
    ['rolls.json', 'rolls'],
    ['dice.json', 'dice'],
    ['cards/skill.json', 'card'],
    ['settings.json', 'settings'],
    ['combat.json', 'combat'],
    ['lang/pt-BR.json', 'lang'],
  ])('reads %s as %s', (path, kind) => {
    expect(pluginFileKind(path)).toBe(kind);
  });

  it.each(['packs/monsters.json', 'types/actors/deep/x.json', 'sheets/a.css', 'Plugin.json'])(
    'has no kind for %s',
    (path) => {
      expect(pluginFileKind(path)).toBeUndefined();
    },
  );
});
