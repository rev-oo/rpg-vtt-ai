import { satisfies, validRange } from 'semver';

import { CORE_API_VERSION } from '@vtt/shared';

import type { Card } from '../cards.js';
import type { Combat } from '../combat.js';
import { DIE_NAME, IDENTIFIER, LOCALE, NAME } from '../common.js';
import { scopeCss } from '../css/scope.js';
import type { Die } from '../dice.js';
import { PLUGIN_FILES, type PluginFileKind, pluginFileKind } from '../json-schema.js';
import type { Lang } from '../lang.js';
import type { Manifest } from '../manifest.js';
import type { Pack } from '../packs.js';
import type { Recipe } from '../rolls.js';
import type { Setting } from '../settings.js';
import type { Sheet, SheetNode } from '../sheet.js';
import type { ActorType, FieldSchema, ItemType } from '../types.js';

import { checkData, checkDataSchema } from './data.js';
import { checkFormula, findCycle, type FormulaRules, type FormulaScope } from './formulas.js';
import type { JsonPath, PluginIssue } from './issues.js';
import { shapeIssues } from './shape.js';

/** Every file of a plugin, parsed and checked; what the registry and the engine use. */
export interface PluginDefinition {
  manifest: Manifest;
  actorTypes: Record<string, ActorType>;
  itemTypes: Record<string, ItemType>;
  sheets: Record<string, Sheet>;
  rolls: Record<string, Recipe>;
  dice: Record<string, Die>;
  cards: Record<string, Card>;
  settings: Record<string, Setting>;
  combat?: Combat | undefined;
  /** Compendium packs by name (ADR-051). The server keeps them; browsers do not get them. */
  packs?: Record<string, Pack> | undefined;
  /** Translations by locale. */
  lang: Record<string, Lang>;
  /** Paths of `styles/*.css`, in order. */
  styles: string[];
}

export interface PluginValidation {
  issues: PluginIssue[];
  /** The manifest, when it passed its own schema; set even when other files have errors. */
  manifest?: Manifest | undefined;
  /** Set when no issue is an error. */
  plugin?: PluginDefinition | undefined;
}

/** `type.character`: a lang key. Text with spaces or without a dot is literal. */
const LANG_KEY = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;
const LIST_PATH: Record<string, { kind: PluginFileKind; of: string }> = {
  'types/actors/': { kind: 'actor-type', of: 'type' },
  'types/items/': { kind: 'item-type', of: 'type' },
  'sheets/': { kind: 'sheet', of: 'sheet' },
  'cards/': { kind: 'card', of: 'card' },
  'packs/': { kind: 'pack', of: 'pack' },
};

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
const withoutSchemaUrl = <T>(record: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => key !== '$schema'));
function fieldAt(schema: FieldSchema, dotPath: string, isRow: boolean): FieldSchema | undefined {
  let field: FieldSchema | undefined = schema;
  for (const name of dotPath.split('.')) {
    if (isRow && field === schema && name === 'id') return { type: 'string' };
    const properties: Record<string, FieldSchema> | undefined = field?.properties;
    field = properties && Object.hasOwn(properties, name) ? properties[name] : undefined;
  }
  return field;
}

const INPUT_TYPES: Record<string, readonly FieldSchema['type'][]> = {
  text: ['string', 'integer', 'number'],
  number: ['integer', 'number'],
  counter: ['integer', 'number'],
  checkbox: ['boolean'],
  select: ['string', 'integer', 'number'],
};

interface TypeEntry {
  name: string;
  file: string;
  label: string;
  type: ActorType | ItemType;
  actor: boolean;
}

/**
 * Validates a plugin folder (FR-PLUGIN-02, specs §8.13): every JSON file against its schema,
 * formulas and their references, links between files, `hasCode`, and translations.
 *
 * `files` maps each path in the folder (`/`-separated, relative) to its text. Only JSON and
 * `styles/*.css` contents are read; other files only need to be listed.
 */
export interface ValidateOptions {
  /** The core API version to check `coreApi` against; this core's by default. */
  coreVersion?: string;
  /** The folder the plugin was found in; its name must be the plugin id. */
  folder?: string;
}

export function validatePlugin(
  files: ReadonlyMap<string, string>,
  { coreVersion = CORE_API_VERSION, folder }: ValidateOptions = {},
): PluginValidation {
  const issues: PluginIssue[] = [];
  const seen = new Set<string>();
  const add = (
    severity: PluginIssue['severity'],
    code: PluginIssue['code'],
    file: string,
    path: JsonPath,
    params: PluginIssue['params'] = {},
  ) => {
    const key = JSON.stringify([code, file, path, params]);
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ severity, code, file, path: [...path], params });
  };
  const error = (
    code: PluginIssue['code'],
    file: string,
    path: JsonPath,
    params?: PluginIssue['params'],
  ) => {
    add('error', code, file, path, params);
  };

  // 1. Parse every file and check its shape.
  const parsed = new Map<string, unknown>();
  const names: Record<string, Set<string>> = {
    'actor-type': new Set(),
    'item-type': new Set(),
    sheet: new Set(),
    card: new Set(),
    pack: new Set(),
  };
  const paths = [...files.keys()].sort();
  for (const path of paths) {
    const kind = pluginFileKind(path);
    if (!kind) {
      if (path.endsWith('.json') && !path.startsWith('code/'))
        add('warning', 'unknown_file', path, []);
      continue;
    }
    const folder = Object.entries(LIST_PATH).find(([prefix]) => path.startsWith(prefix));
    if (folder) {
      const name = baseName(path);
      names[folder[1].kind]?.add(name);
      if (!NAME.test(name)) error('invalid_name', path, [], { name, of: folder[1].of });
    }
    if (kind === 'lang' && !LOCALE.test(baseName(path))) {
      error('invalid_name', path, [], { name: baseName(path), of: 'locale' });
    }
    let data: unknown;
    try {
      data = JSON.parse(files.get(path) ?? '');
    } catch (cause) {
      error('invalid_json', path, [], {
        detail: cause instanceof Error ? cause.message : String(cause),
      });
      continue;
    }
    const result = PLUGIN_FILES[kind].schema.safeParse(data);
    if (!result.success) {
      for (const issue of shapeIssues(path, kind, data, result.error.issues)) {
        error(issue.code, issue.file, issue.path, issue.params);
      }
      continue;
    }
    parsed.set(path, result.data);
  }

  const one = (path: string): unknown => parsed.get(path);
  const many = <T>(prefix: string) =>
    Object.fromEntries(
      [...parsed]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, data]) => [baseName(path), data as T]),
    );

  const manifest = one('plugin.json') as Manifest | undefined;
  if (!files.has('plugin.json')) error('missing_file', 'plugin.json', [], { file: 'plugin.json' });
  const codeFolder = paths.some((path) => path.startsWith('code/'));
  if (manifest && manifest.hasCode !== codeFolder) {
    error('has_code_mismatch', 'plugin.json', ['hasCode'], { hasCode: String(manifest.hasCode) });
  }
  const hasCode = manifest?.hasCode ?? codeFolder;
  if (manifest && folder !== undefined && manifest.id !== folder) {
    error('folder_mismatch', 'plugin.json', ['id'], { folder });
  }
  if (manifest) {
    const range = validRange(manifest.coreApi);
    if (range === null) {
      error('invalid_core_api', 'plugin.json', ['coreApi'], { coreApi: manifest.coreApi });
    } else if (!satisfies(coreVersion, range)) {
      error('incompatible_core_api', 'plugin.json', ['coreApi'], {
        coreApi: manifest.coreApi,
        core: coreVersion,
      });
    }
  }

  const rolls = withoutSchemaUrl((one('rolls.json') as Record<string, Recipe> | undefined) ?? {});
  const dice = withoutSchemaUrl((one('dice.json') as Record<string, Die> | undefined) ?? {});
  const settings = withoutSchemaUrl(
    (one('settings.json') as Record<string, Setting> | undefined) ?? {},
  );
  const sheets = many<Sheet>('sheets/');
  const cards = many<Card>('cards/');
  // A lang file with an invalid locale name is reported above and not used.
  const lang = Object.fromEntries(
    Object.entries(many<Lang>('lang/')).filter(([locale]) => LOCALE.test(locale)),
  );
  const actorTypes = many<ActorType>('types/actors/');
  const itemTypes = many<ItemType>('types/items/');
  const combat = one('combat.json') as Combat | undefined;
  const packs = many<Pack>('packs/');

  for (const [file, keys, pattern, of] of [
    ['rolls.json', Object.keys(rolls), NAME, 'roll'],
    ['dice.json', Object.keys(dice), DIE_NAME, 'die'],
    ['settings.json', Object.keys(settings), IDENTIFIER, 'setting'],
  ] as const) {
    for (const key of keys)
      if (!pattern.test(key)) error('invalid_name', file, [key], { name: key, of });
  }

  const rules = (allowDice: boolean): FormulaRules => ({
    dice: allowDice,
    customDice: new Set(Object.keys(dice)),
    anyFunction: hasCode,
  });
  const settingNames = new Set(Object.keys(settings));
  const formula = (
    source: string,
    scope: FormulaScope,
    allowDice: boolean,
    file: string,
    path: JsonPath,
  ) =>
    checkFormula(source, scope, rules(allowDice), (code, params) => {
      error(code, file, path, params);
    });

  // Lang keys used anywhere, with where they were first seen.
  const usedKeys = new Map<string, { file: string; path: JsonPath }>();
  const useText = (text: string | undefined, file: string, path: JsonPath) => {
    if (text !== undefined && LANG_KEY.test(text) && !usedKeys.has(text))
      usedKeys.set(text, { file, path });
  };

  // 2. Types: data schemas, derived values and their order.
  const types: TypeEntry[] = [
    ...Object.entries(actorTypes).map(([name, type]) => ({
      name,
      type,
      actor: true,
      file: `types/actors/${name}.json`,
      label: `actor type "${name}"`,
    })),
    ...Object.entries(itemTypes).map(([name, type]) => ({
      name,
      type,
      actor: false,
      file: `types/items/${name}.json`,
      label: `item type "${name}"`,
    })),
  ];
  const typeScope = (entry: TypeEntry): FormulaScope => ({
    label: entry.label,
    data: entry.type.schema,
    derived: new Set(Object.keys(entry.type.derived ?? {})),
    settings: settingNames,
  });
  for (const entry of types) {
    const { type, file } = entry;
    useText(type.label, file, ['label']);
    // Actor types always name who controls them; item types may name a group.
    if (!('controlledBy' in type)) {
      useText(type.group, file, ['group']);
      useText(type.labelPlural, file, ['labelPlural']);
    }
    checkDataSchema(type.schema, (code, path, params) => {
      error(code, file, path, params);
    });
    const graph = new Map<string, string[]>();
    for (const [name, source] of Object.entries(type.derived ?? {})) {
      const scope = typeScope(entry);
      graph.set(name, formula(source, scope, false, file, ['derived', name]) ?? []);
    }
    const cycle = findCycle(graph);
    if (cycle?.[0] !== undefined)
      error('derived_cycle', file, ['derived', cycle[0]], { cycle: cycle.join(' → ') });
    if (!names.sheet?.has(type.sheet))
      error('missing_target', file, ['sheet'], { target: 'sheet', name: type.sheet });
  }

  // 3. Sheets, checked against every type that uses them.
  const recipeUsers = new Map<string, Set<TypeEntry>>();
  const walkSheet = (sheetName: string, entry: TypeEntry | undefined) => {
    const sheet = sheets[sheetName];
    if (!sheet) return;
    const file = `sheets/${sheetName}.json`;
    const scope: FormulaScope = entry
      ? typeScope(entry)
      : { label: `sheet "${sheetName}"`, settings: settingNames };

    const walk = (
      node: SheetNode,
      path: JsonPath,
      /** The enclosing list's rows; without a schema when the list's field is unknown. */
      row: { schema: FieldSchema | undefined; label: string } | undefined,
    ) => {
      const nodeScope: FormulaScope = row ? { ...scope, row: row.schema ?? 'unchecked' } : scope;
      if (node.visibleIf !== undefined)
        formula(node.visibleIf, nodeScope, false, file, [...path, 'visibleIf']);
      const children = (list: SheetNode[], key: string) => {
        list.forEach((child, index) => {
          walk(child, [...path, key, index], row);
        });
      };
      const field = (dotPath: string, expected: string, fits: (field: FieldSchema) => boolean) => {
        const base = row ? row.schema : entry?.type.schema;
        if (!base) return undefined;
        const found = fieldAt(base, dotPath, row !== undefined);
        if (!found) {
          error('unknown_field', file, [...path, 'path'], {
            field: dotPath,
            scope: row?.label ?? scope.label,
          });
        } else if (!fits(found)) {
          error('field_mismatch', file, [...path, 'path'], { field: dotPath, expected });
        }
        return found;
      };

      switch (node.type) {
        case 'row':
        case 'column':
        case 'grid':
          children(node.children, 'children');
          break;
        case 'section':
          useText(node.title, file, [...path, 'title']);
          children(node.children, 'children');
          break;
        case 'tabs':
          node.tabs.forEach((tab, index) => {
            useText(tab.label, file, [...path, 'tabs', index, 'label']);
            tab.children.forEach((child, childIndex) => {
              walk(child, [...path, 'tabs', index, 'children', childIndex], row);
            });
          });
          break;
        case 'field': {
          useText(node.label, file, [...path, 'label']);
          const input = node.input ?? 'text';
          const allowed = INPUT_TYPES[input] ?? [];
          const expected =
            input === 'select' ? 'a field with enum' : `a ${allowed.join(' or ')} field`;
          field(
            node.path,
            expected,
            (found) =>
              allowed.includes(found.type) && (input !== 'select' || found.enum !== undefined),
          );
          break;
        }
        case 'longText':
          useText(node.label, file, [...path, 'label']);
          field(
            node.path,
            'a longText or richText field',
            (found) => found['x-kind'] === 'longText' || found['x-kind'] === 'richText',
          );
          break;
        case 'image':
          field(node.path, 'a string field', (found) => found.type === 'string');
          break;
        case 'list': {
          useText(node.addLabel, file, [...path, 'addLabel']);
          const found = field(
            node.path,
            'an array field',
            (candidate) => candidate.type === 'array',
          );
          const items = found?.type === 'array' ? found.items : undefined;
          walk(node.item, [...path, 'item'], {
            schema: items,
            label: `the rows of "${node.path}"`,
          });
          break;
        }
        case 'rollButton':
          useText(node.label, file, [...path, 'label']);
          if (!Object.hasOwn(rolls, node.roll)) {
            // A rolls.json that failed its own checks is already reported.
            if (one('rolls.json') !== undefined || !files.has('rolls.json')) {
              error('missing_target', file, [...path, 'roll'], { target: 'roll', name: node.roll });
            }
          } else if (entry) {
            const users = recipeUsers.get(node.roll) ?? new Set();
            recipeUsers.set(node.roll, users.add(entry));
          }
          for (const [key, value] of Object.entries(node.args ?? {})) {
            if (typeof value === 'string')
              formula(value, nodeScope, false, file, [...path, 'args', key]);
          }
          break;
        case 'derived':
          useText(node.label, file, [...path, 'label']);
          if (entry && !Object.hasOwn(entry.type.derived ?? {}, node.key)) {
            error('missing_target', file, [...path, 'key'], {
              target: 'derived value',
              name: node.key,
            });
          }
          break;
        case 'text':
          useText(node.text, file, [...path, 'text']);
          break;
        default:
          if (!hasCode)
            error('code_required', file, [...path, 'type'], { feature: `The node "${node.type}"` });
      }
    };
    walk(sheet.layout, ['layout'], undefined);
  };
  for (const sheetName of Object.keys(sheets)) {
    const users = types.filter((entry) => entry.type.sheet === sheetName);
    if (users.length === 0) walkSheet(sheetName, undefined);
    for (const entry of users) walkSheet(sheetName, entry);
  }

  // 4. Roll recipes, checked against the types whose sheets roll them.
  const cardUsers = new Map<string, FormulaScope[]>();
  for (const [name, recipe] of Object.entries(rolls)) {
    const file = 'rolls.json';
    useText(recipe.label, file, [name, 'label']);
    if ('handler' in recipe) {
      if (!hasCode)
        error('code_required', file, [name, 'handler'], { feature: `The roll "${name}"` });
      continue;
    }
    const users = [...(recipeUsers.get(name) ?? [])];
    const scopes: FormulaScope[] = (
      users.length > 0
        ? users.map(typeScope)
        : [{ label: `roll "${name}"`, settings: settingNames }]
    ).map((scope) => ({ ...scope, args: true }));
    for (const scope of scopes) {
      formula(recipe.formula, scope, true, file, [name, 'formula']);
      recipe.outcomes?.forEach((outcome, index) => {
        if (outcome.when !== undefined)
          formula(outcome.when, { ...scope, roll: true }, false, file, [
            name,
            'outcomes',
            index,
            'when',
          ]);
      });
    }
    recipe.outcomes?.forEach((outcome, index) => {
      useText(outcome.label, file, [name, 'outcomes', index, 'label']);
    });
    if (recipe.card !== undefined) {
      if (!names.card?.has(recipe.card))
        error('missing_target', file, [name, 'card'], { target: 'card', name: recipe.card });
      cardUsers.set(recipe.card, [...(cardUsers.get(recipe.card) ?? []), ...scopes]);
    }
  }

  // 5. Cards, dice, settings and combat.
  for (const [name, card] of Object.entries(cards)) {
    const file = `cards/${name}.json`;
    useText(card.title, file, ['title']);
    const scopes = cardUsers.get(name) ?? [{ label: `card "${name}"`, settings: settingNames }];
    card.rows.forEach((row, index) => {
      useText(row.label, file, ['rows', index, 'label']);
      for (const scope of scopes)
        formula(row.value, { ...scope, roll: true }, false, file, ['rows', index, 'value']);
    });
  }
  for (const [name, die] of Object.entries(dice)) useText(die.label, 'dice.json', [name, 'label']);
  for (const [name, setting] of Object.entries(settings)) {
    useText(setting.label, 'settings.json', [name, 'label']);
    useText(setting.description, 'settings.json', [name, 'description']);
  }
  if (combat?.initiative !== undefined) {
    const actors = types.filter((entry) => entry.actor);
    const scopes =
      actors.length > 0 ? actors.map(typeScope) : [{ label: 'combat', settings: settingNames }];
    for (const scope of scopes)
      formula(combat.initiative, scope, true, 'combat.json', ['initiative']);
  }

  // Packs: entries of the plugin's own types, with data that fits them (ADR-051).
  for (const [packName, pack] of Object.entries(packs)) {
    const file = `packs/${packName}.json`;
    useText(pack.label, file, ['label']);
    const ids = new Set<string>();
    pack.entries.forEach((entry, index) => {
      const path = ['entries', index];
      if (ids.has(entry.id)) error('duplicate_id', file, [...path, 'id'], { id: entry.id });
      ids.add(entry.id);
      const declared = entry.kind === 'actor' ? actorTypes : itemTypes;
      const type = Object.hasOwn(declared, entry.type) ? declared[entry.type] : undefined;
      if (!type) {
        error('missing_target', file, [...path, 'type'], {
          target: `${entry.kind} type`,
          name: entry.type,
        });
        return;
      }
      checkData(type.schema, entry.data ?? {}, [...path, 'data'], (code, at, params) => {
        error(code, file, at, params);
      });
    });
  }

  // 6. Styles: the same scoping the server applies (§8.6).
  const styles = paths.filter((path) => /^styles\/[^/]+\.css$/.test(path));
  for (const path of styles) {
    const scoped = scopeCss(files.get(path) ?? '', {
      pluginId: folder ?? manifest?.id ?? 'plugin',
      file: path,
    });
    for (const issue of scoped.issues)
      add(issue.severity, issue.code, issue.file, issue.path, issue.params);
  }

  // 7. Translations: English is required once any lang file exists (specs §8.2).
  const locales = new Set(paths.filter((path) => pluginFileKind(path) === 'lang').map(baseName));
  const listed = manifest?.locales;
  if (locales.size > 0 || listed) {
    const required = new Set(['en', ...(listed ?? [])]);
    for (const locale of required) {
      if (!locales.has(locale)) error('missing_lang_file', `lang/${locale}.json`, [], { locale });
    }
    if (listed) {
      for (const locale of locales) {
        if (!listed.includes(locale))
          add('warning', 'unlisted_locale', `lang/${locale}.json`, [], { locale });
      }
      if (manifest.defaultLocale !== undefined && !listed.includes(manifest.defaultLocale)) {
        error('unlisted_locale', 'plugin.json', ['defaultLocale'], {
          locale: manifest.defaultLocale,
        });
      }
    }
    for (const [key, where] of usedKeys) {
      for (const [locale, entries] of Object.entries(lang)) {
        if (Object.hasOwn(entries, key)) continue;
        // English is the fallback (FR-PLUGIN-05), so only a missing English text is an error.
        add(locale === 'en' ? 'error' : 'warning', 'missing_lang_key', where.file, where.path, {
          key,
          locale,
        });
      }
    }
  }

  const valid = manifest !== undefined && !issues.some((issue) => issue.severity === 'error');
  return {
    issues,
    manifest,
    plugin: valid
      ? {
          manifest,
          actorTypes,
          itemTypes,
          sheets,
          rolls,
          dice,
          cards,
          settings,
          combat,
          ...(Object.keys(packs).length > 0 && { packs: withoutSchemaUrl(packs) }),
          lang,
          styles,
        }
      : undefined,
  };
}
