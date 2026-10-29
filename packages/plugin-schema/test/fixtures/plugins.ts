// Plugin fixtures for the validator (T-0402): a small valid plugin and the ways to break it.
// Each case changes a fresh copy of `mini` and lists every issue the validator must report,
// as `<severity> <code> <file> <JSON path>`.

export type PluginFixture = Record<string, unknown>;

export function mini(): PluginFixture {
  return {
    'plugin.json': {
      id: 'mini',
      name: 'Mini',
      version: '1.0.0',
      kind: 'system',
      coreApi: '^0.1.0',
      hasCode: false,
      locales: ['en', 'pt-BR'],
    },
    'types/actors/hero.json': {
      label: 'type.hero',
      controlledBy: 'player',
      sheet: 'hero',
      schema: {
        type: 'object',
        properties: {
          str: { type: 'integer', default: 10, minimum: 1, maximum: 30 },
          hp: {
            type: 'object',
            properties: { value: { type: 'integer', default: 5, 'x-counter': true } },
          },
          skills: {
            type: 'array',
            'x-kind': 'collection',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, rank: { type: 'integer', default: 0 } },
            },
          },
          notes: { type: 'string', 'x-kind': 'longText' },
        },
      },
      derived: { mod: 'floor((@str - 10) / 2)' },
    },
    'sheets/hero.json': {
      layout: {
        type: 'column',
        children: [
          { type: 'field', path: 'str', input: 'number' },
          { type: 'field', path: 'hp.value', input: 'counter', visibleIf: '@derived.mod > -5' },
          { type: 'derived', key: 'mod' },
          {
            type: 'list',
            path: 'skills',
            item: {
              type: 'row',
              children: [
                { type: 'field', path: 'name' },
                { type: 'rollButton', roll: 'skill', label: 'roll.skill', args: { id: '@row.id' } },
              ],
            },
          },
          { type: 'longText', path: 'notes' },
        ],
      },
    },
    'rolls.json': {
      skill: {
        formula: '1d20 + @derived.mod + @skills[@args.id].rank',
        outcomes: [{ when: '@total >= 10', label: 'outcome.ok' }, { label: 'outcome.no' }],
        card: 'roll',
      },
    },
    'cards/roll.json': {
      title: 'card.title',
      rows: [{ label: 'card.total', value: '@total' }],
    },
    'dice.json': { dF: { faces: ['-', ' ', '+'], values: { '-': -1, ' ': 0, '+': 1 } } },
    'lang/en.json': LANG,
    'lang/pt-BR.json': LANG,
    'styles/sheet.css': '',
  };
}

const LANG = {
  'type.hero': 'Hero',
  'roll.skill': 'Roll',
  'outcome.ok': 'Success',
  'outcome.no': 'Failure',
  'card.title': 'Check',
  'card.total': 'Total',
};

/** Reads a nested value of a fixture file, for the cases to change in place. */
function at(
  fixture: PluginFixture,
  file: string,
  ...path: (string | number)[]
): Record<string, unknown> {
  let value = fixture[file];
  for (const key of path) value = (value as Record<string | number, unknown>)[key];
  return value as Record<string, unknown>;
}

const hero = (fixture: PluginFixture) => at(fixture, 'types/actors/hero.json');
const heroFields = (fixture: PluginFixture) =>
  at(fixture, 'types/actors/hero.json', 'schema', 'properties');
const sheetChildren = (fixture: PluginFixture) =>
  at(fixture, 'sheets/hero.json', 'layout', 'children') as unknown as unknown[];
const skill = (fixture: PluginFixture) => at(fixture, 'rolls.json', 'skill');

export interface FixtureCase {
  name: string;
  change: (fixture: PluginFixture) => void;
  issues: string[];
  /** Warnings alone leave the plugin usable. */
  valid?: boolean;
}

export const CASES: FixtureCase[] = [
  {
    name: 'a core API this server does not provide',
    change: (f: PluginFixture): void => {
      at(f, 'plugin.json').coreApi = '^2.0.0';
    },
    issues: ['error incompatible_core_api plugin.json $.coreApi'],
  },
  {
    name: 'a coreApi that is not a range',
    change: (f: PluginFixture): void => {
      at(f, 'plugin.json').coreApi = 'latest and greatest';
    },
    issues: ['error invalid_core_api plugin.json $.coreApi'],
  },
  {
    name: 'no manifest',
    change: (f: PluginFixture): void => {
      delete f['plugin.json'];
    },
    issues: ['error missing_file plugin.json $'],
  },
  {
    name: 'a file that is not JSON',
    change: (f: PluginFixture): void => {
      f['sheets/hero.json'] = '{ "layout": ';
    },
    issues: ['error invalid_json sheets/hero.json $'],
  },
  {
    name: 'an unknown manifest key and a bad id',
    change: (f: PluginFixture): void => {
      Object.assign(at(f, 'plugin.json'), { homepage: 'x', id: 'Mini' });
    },
    issues: ['error invalid_value plugin.json $.id', 'error unknown_key plugin.json $.homepage'],
  },
  {
    name: 'values of the wrong type, size or choice',
    change: (f: PluginFixture): void => {
      Object.assign(at(f, 'plugin.json'), { name: '', kind: 'module', hasCode: 'no' });
      sheetChildren(f).push({ type: 'grid', columns: 20, children: [] });
      hero(f).controlledBy = 'anyone';
    },
    issues: [
      'error invalid_value plugin.json $.name',
      'error invalid_value plugin.json $.kind',
      'error invalid_value plugin.json $.hasCode',
      'error invalid_value sheets/hero.json $.layout.children[5].columns',
      'error invalid_value types/actors/hero.json $.controlledBy',
    ],
  },
  {
    name: 'settings and combat formulas',
    change: (f: PluginFixture): void => {
      f['settings.json'] = {
        bonus: { type: 'integer', default: 1, label: 'Bonus', description: 'A bonus' },
      };
      f['combat.json'] = {
        initiative: '1d20 + @str + @settings.bonus + @settings.other',
        order: 'desc',
      };
      skill(f).formula = '1d20 + @settings.bonus';
    },
    issues: ['error unknown_reference combat.json $.initiative'],
  },
  {
    name: 'a pack whose entries fit their types',
    change: (f: PluginFixture): void => {
      f['packs/heroes.json'] = {
        label: 'Heroes',
        entries: [
          {
            id: 'ayla',
            kind: 'actor',
            type: 'hero',
            name: 'Ayla',
            data: { str: 14, hp: { value: 3 }, skills: [{ name: 'Climb', rank: 2 }] },
          },
          { id: 'bo', kind: 'actor', type: 'hero', name: 'Bo' },
        ],
      };
    },
    issues: [],
    valid: true,
  },
  {
    name: 'item groups and plural labels in the plugin language (T-1203)',
    change: (f: PluginFixture): void => {
      f['sheets/item.json'] = { layout: { type: 'column', children: [] } };
      f['types/items/spell.json'] = {
        label: 'Spell',
        labelPlural: 'type.spells',
        group: 'group.magic',
        order: 2,
        sheet: 'item',
        schema: { type: 'object', properties: {} },
      };
      f['types/items/gem.json'] = {
        label: 'Gem',
        labelPlural: 'Gems',
        order: -1,
        sheet: 'item',
        schema: { type: 'object', properties: {} },
      };
      f['lang/en.json'] = { ...LANG, 'type.spells': 'Spells', 'group.magic': 'Magic' };
      f['lang/pt-BR.json'] = { ...LANG, 'type.spells': 'Magias', 'group.magic': 'Magia' };
    },
    issues: [],
    valid: true,
  },
  {
    name: 'item groups need their lang keys, and an order is a whole number (T-1203)',
    change: (f: PluginFixture): void => {
      f['sheets/item.json'] = { layout: { type: 'column', children: [] } };
      f['types/items/spell.json'] = {
        label: 'Spell',
        labelPlural: 'type.spells',
        group: 'group.magic',
        sheet: 'item',
        schema: { type: 'object', properties: {} },
      };
      f['types/items/gem.json'] = {
        label: 'Gem',
        order: 1.5,
        sheet: 'item',
        schema: { type: 'object', properties: {} },
      };
    },
    issues: [
      'error invalid_value types/items/gem.json $.order',
      'error missing_lang_key types/items/spell.json $.group',
      'warning missing_lang_key types/items/spell.json $.group',
      'error missing_lang_key types/items/spell.json $.labelPlural',
      'warning missing_lang_key types/items/spell.json $.labelPlural',
    ],
  },
  {
    name: 'item contributions read by actor formulas (T-1205)',
    change: (f: PluginFixture): void => {
      f['sheets/item.json'] = { layout: { type: 'column', children: [] } };
      f['types/items/ring.json'] = {
        label: 'Ring',
        sheet: 'item',
        schema: {
          type: 'object',
          properties: {
            worn: { type: 'boolean', default: false },
            bonus: { type: 'integer', default: 1 },
            curse: { type: 'string', default: '', 'x-layer': 'secret' },
          },
        },
        derived: { counted: '@worn ? @bonus : 0' },
        contributes: {
          hpBonus: { formula: '@derived.counted' },
          best: { formula: '@bonus', combine: 'max', default: 0 },
          worn: { formula: '@worn', combine: 'count' },
        },
      };
      f['types/items/belt.json'] = {
        label: 'Belt',
        sheet: 'item',
        schema: { type: 'object', properties: { bonus: { type: 'integer', default: 2 } } },
        contributes: { hpBonus: { formula: '@bonus', combine: 'sum' } },
      };
      hero(f).derived = {
        mod: 'floor((@str - 10) / 2)',
        maxHp: '10 + @items.hpBonus + @items.best',
      };
      sheetChildren(f).push({ type: 'text', text: 'Rings', visibleIf: '@items.worn > 0' });
    },
    issues: [],
    valid: true,
  },
  {
    name: 'contributions that disagree, leak secrets or loop through items (T-1205)',
    change: (f: PluginFixture): void => {
      f['sheets/item.json'] = { layout: { type: 'column', children: [] } };
      f['types/items/ring.json'] = {
        label: 'Ring',
        sheet: 'item',
        schema: {
          type: 'object',
          properties: {
            bonus: { type: 'integer', default: 1 },
            gm: {
              type: 'object',
              properties: { curse: { type: 'integer', default: 0, 'x-layer': 'secret' } },
            },
          },
        },
        derived: { cursed: '@gm.curse * 2', total: '@items.hpBonus' },
        contributes: {
          hpBonus: { formula: '@bonus' },
          best: { formula: '@bonus', combine: 'max' },
          worst: { formula: '@bonus', combine: 'sum', default: 1 },
          leak: { formula: '@derived.cursed + @gm.curse' },
          loop: { formula: '@items.hpBonus' },
        },
      };
      f['types/items/belt.json'] = {
        label: 'Belt',
        sheet: 'item',
        schema: { type: 'object', properties: { bonus: { type: 'integer', default: 2 } } },
        contributes: { hpBonus: { formula: '@bonus', combine: 'max', default: 0 } },
      };
      hero(f).derived = { mod: 'floor((@str - 10) / 2)', maxHp: '10 + @items.nope' };
    },
    issues: [
      'error contribution_mismatch types/items/ring.json $.contributes.hpBonus.combine',
      'error contribution_default types/items/ring.json $.contributes.best',
      'error contribution_default types/items/ring.json $.contributes.worst',
      'error secret_contribution types/items/ring.json $.contributes.leak.formula',
      'error secret_contribution types/items/ring.json $.contributes.leak.formula',
      'error unknown_reference types/items/ring.json $.contributes.loop.formula',
      'error unknown_reference types/items/ring.json $.derived.total',
      'error unknown_reference types/actors/hero.json $.derived.maxHp',
    ],
  },
  {
    name: 'an items node on an actor sheet, with rows checked per type (T-1206)',
    change: (f: PluginFixture): void => {
      f['sheets/item.json'] = { layout: { type: 'column', children: [] } };
      f['types/items/armor.json'] = {
        label: 'Armor',
        sheet: 'item',
        schema: {
          type: 'object',
          properties: {
            equipped: { type: 'boolean', default: false },
            bonus: { type: 'integer', default: 1 },
          },
        },
      };
      f['types/items/weapon.json'] = {
        label: 'Weapon',
        sheet: 'item',
        schema: {
          type: 'object',
          properties: {
            equipped: { type: 'boolean', default: false },
            damage: { type: 'string', default: '1d6' },
          },
        },
      };
      sheetChildren(f).push({
        type: 'items',
        itemTypes: ['armor', 'weapon'],
        addLabel: 'Add gear',
        item: {
          type: 'row',
          children: [
            { type: 'field', path: 'equipped', input: 'checkbox' },
            { type: 'text', text: 'Gear', visibleIf: "@item.name != '' and @str > 0" },
            { type: 'field', path: 'bonus', input: 'number', visibleIf: "@item.type == 'armor'" },
            {
              type: 'field',
              path: 'damage',
              visibleIf: "@item.type == 'weapon' or @item.type == 'wand'",
            },
            { type: 'rollButton', roll: 'skill', label: 'roll.skill', args: { id: '@item.id' } },
          ],
        },
      });
    },
    issues: [],
    valid: true,
  },
  {
    name: 'items nodes with unguarded fields, unknown types, nesting and item sheets (T-1206)',
    change: (f: PluginFixture): void => {
      f['sheets/item.json'] = {
        layout: { type: 'items', item: { type: 'text', text: 'x' } },
      };
      f['types/items/armor.json'] = {
        label: 'Armor',
        sheet: 'item',
        schema: { type: 'object', properties: { bonus: { type: 'integer', default: 1 } } },
      };
      f['types/items/weapon.json'] = {
        label: 'Weapon',
        sheet: 'item',
        schema: { type: 'object', properties: { damage: { type: 'string', default: '1d6' } } },
      };
      sheetChildren(f).push(
        {
          type: 'items',
          itemTypes: ['armor', 'wand'],
          item: {
            type: 'column',
            children: [
              { type: 'field', path: 'damage' },
              { type: 'text', text: 'x', visibleIf: '@item.owner' },
              { type: 'items', item: { type: 'text', text: 'x' } },
            ],
          },
        },
        {
          type: 'list',
          path: 'skills',
          item: { type: 'items', item: { type: 'text', text: 'x', visibleIf: '@item.id' } },
        },
        { type: 'text', text: 'x', visibleIf: "@item.type == 'armor'" },
      );
    },
    issues: [
      'error actor_sheet_node sheets/item.json $.layout.type',
      'error actor_sheet_node sheets/item.json $.layout.type',
      'error missing_target sheets/hero.json $.layout.children[5].itemTypes[1]',
      'error unknown_field sheets/hero.json $.layout.children[5].item.children[0].path',
      'error unknown_reference sheets/hero.json $.layout.children[5].item.children[1].visibleIf',
      'error nested_items sheets/hero.json $.layout.children[5].item.children[2].type',
      'error nested_items sheets/hero.json $.layout.children[6].item.type',
      'error unknown_reference sheets/hero.json $.layout.children[7].visibleIf',
    ],
  },
  {
    name: 'a pack with bad entries, reported by JSON path (T-0803)',
    change: (f: PluginFixture): void => {
      f['packs/bad.json'] = {
        label: 'pack.bad',
        entries: [
          {
            id: 'a',
            kind: 'actor',
            type: 'hero',
            name: 'A',
            data: { str: 99, hp: { value: 'x' }, skills: [{ rank: 1.5 }], wings: true },
          },
          { id: 'a', kind: 'item', type: 'hero', name: 'B' },
        ],
      };
      f['packs/broken.json'] = { label: 'Broken', entries: [{ id: 'x', kind: 'spell' }] };
    },
    issues: [
      'error invalid_value packs/bad.json $.entries[0].data.str',
      'error invalid_value packs/bad.json $.entries[0].data.hp.value',
      'error invalid_value packs/bad.json $.entries[0].data.skills[0].rank',
      'error unknown_key packs/bad.json $.entries[0].data.wings',
      'error duplicate_id packs/bad.json $.entries[1].id',
      'error missing_target packs/bad.json $.entries[1].type',
      'error missing_lang_key packs/bad.json $.label',
      'warning missing_lang_key packs/bad.json $.label',
      'error invalid_value packs/broken.json $.entries[0].kind',
      'error missing_key packs/broken.json $.entries[0].type',
      'error missing_key packs/broken.json $.entries[0].name',
    ],
  },
  {
    name: 'a missing required key',
    change: (f: PluginFixture): void => {
      delete hero(f).controlledBy;
    },
    issues: ['error missing_key types/actors/hero.json $.controlledBy'],
  },
  {
    name: 'unsupported schema keywords',
    change: (f: PluginFixture): void => {
      Object.assign(heroFields(f).str as object, { $ref: '#/x', oneOf: [] });
    },
    issues: [
      'error unsupported_keyword types/actors/hero.json $.schema.properties.str.$ref',
      'error unsupported_keyword types/actors/hero.json $.schema.properties.str.oneOf',
    ],
  },
  {
    name: 'a field name formulas cannot reference',
    change: (f: PluginFixture): void => {
      heroFields(f)['hit-points'] = { type: 'integer' };
    },
    issues: ['error invalid_name types/actors/hero.json $.schema.properties["hit-points"]'],
  },
  {
    name: 'an unknown sheet node',
    change: (f: PluginFixture): void => {
      sheetChildren(f)[0] = { type: 'video' };
    },
    issues: ['error unknown_node sheets/hero.json $.layout.children[0]'],
  },
  {
    name: 'a broken built-in node, reported once',
    change: (f: PluginFixture): void => {
      sheetChildren(f)[0] = { type: 'field', path: 'skills[0]' };
    },
    issues: ['error invalid_value sheets/hero.json $.layout.children[0].path'],
  },
  {
    name: 'a formula that does not parse',
    change: (f: PluginFixture): void => {
      at(f, 'types/actors/hero.json', 'derived').mod = 'floor((@str - 10) / ';
    },
    issues: ['error invalid_formula types/actors/hero.json $.derived.mod'],
  },
  {
    name: 'references that do not exist',
    change: (f: PluginFixture): void => {
      at(f, 'types/actors/hero.json', 'derived').mod =
        '@strength + @hp.max + @total + @derived.nope';
      skill(f).formula = '1d20 + @skills[@args.id].bonus + @row.rank';
    },
    // One issue per reference: @strength, @hp.max, @total, @derived.nope; then .bonus, @row.
    issues: [
      ...Array<string>(4).fill('error unknown_reference types/actors/hero.json $.derived.mod'),
      ...Array<string>(2).fill('error unknown_reference rolls.json $.skill.formula'),
    ],
  },
  {
    name: 'unknown functions and dice, and dice outside rolls',
    change: (f: PluginFixture): void => {
      at(f, 'types/actors/hero.json', 'derived').mod = 'sqrt(@str) + 1d6';
      skill(f).formula = '4dX + 1dF';
    },
    issues: [
      'error unknown_function types/actors/hero.json $.derived.mod',
      'error dice_not_allowed types/actors/hero.json $.derived.mod',
      'error unknown_die rolls.json $.skill.formula',
    ],
  },
  {
    name: 'derived values that depend on each other',
    change: (f: PluginFixture): void => {
      hero(f).derived = { a: '@derived.b + 1', b: '@derived.a', mod: '@str' };
    },
    issues: ['error derived_cycle types/actors/hero.json $.derived.a'],
  },
  {
    name: 'sheet fields missing from the schema or of the wrong type',
    change: (f: PluginFixture): void => {
      sheetChildren(f).push(
        { type: 'field', path: 'dex' },
        { type: 'field', path: 'str', input: 'checkbox' },
        { type: 'field', path: 'str', input: 'select' },
        { type: 'longText', path: 'str' },
        { type: 'list', path: 'hp', item: { type: 'text', text: 'x' } },
        { type: 'field', path: 'hp' },
      );
    },
    issues: [
      'error unknown_field sheets/hero.json $.layout.children[5].path',
      'error field_mismatch sheets/hero.json $.layout.children[6].path',
      'error field_mismatch sheets/hero.json $.layout.children[7].path',
      'error field_mismatch sheets/hero.json $.layout.children[8].path',
      'error field_mismatch sheets/hero.json $.layout.children[9].path',
      'error field_mismatch sheets/hero.json $.layout.children[10].path',
    ],
  },
  {
    name: 'links to sheets, rolls, cards and derived values that do not exist',
    change: (f: PluginFixture): void => {
      hero(f).sheet = 'villain';
      f['types/actors/villain.json'] = { ...hero(f), sheet: 'lair' };
      skill(f).card = 'fancy';
      sheetChildren(f).push(
        { type: 'rollButton', roll: 'attack', label: 'roll.skill' },
        { type: 'derived', key: 'dexMod' },
      );
      f['types/items/gem.json'] = {
        label: 'Gem',
        sheet: 'hero',
        schema: { type: 'object', properties: {} },
      };
    },
    issues: [
      'error missing_target types/actors/hero.json $.sheet',
      'error missing_target types/actors/villain.json $.sheet',
      'error missing_target rolls.json $.skill.card',
      'error missing_target sheets/hero.json $.layout.children[5].roll',
      'error missing_target sheets/hero.json $.layout.children[6].key',
      'error unknown_field sheets/hero.json $.layout.children[0].path',
      'error unknown_field sheets/hero.json $.layout.children[1].path',
      'error missing_target sheets/hero.json $.layout.children[2].key',
      'error unknown_field sheets/hero.json $.layout.children[3].path',
      'error unknown_field sheets/hero.json $.layout.children[4].path',
      'error unknown_reference sheets/hero.json $.layout.children[1].visibleIf',
      // The item type rolls `skill` too, without the fields the recipe reads.
      'error unknown_reference rolls.json $.skill.formula',
      'error unknown_reference rolls.json $.skill.formula',
    ],
  },
  {
    name: 'invalid defaults and annotations',
    change: (f: PluginFixture): void => {
      Object.assign(heroFields(f), {
        str: { type: 'integer', default: 40, maximum: 30 },
        title: { type: 'string', default: 3, 'x-counter': true },
        rank: { type: 'string', enum: ['a', 'b'], default: 'c', 'x-kind': 'collection' },
        derived: { type: 'integer' },
        speed: { type: 'number', default: 'fast' },
        tags: { type: 'array', items: { type: 'string', minLength: 2 }, default: {} },
        bag: { type: 'object', properties: {}, default: [] },
        nick: { type: 'string', default: 'a', minLength: 2 },
        ready: { type: 'boolean', default: true },
      });
    },
    issues: [
      'error reserved_name types/actors/hero.json $.schema.properties.derived',
      'error invalid_default types/actors/hero.json $.schema.properties.str.default',
      'error invalid_default types/actors/hero.json $.schema.properties.title.default',
      'error invalid_annotation types/actors/hero.json $.schema.properties.title["x-counter"]',
      'error invalid_default types/actors/hero.json $.schema.properties.rank.default',
      'error invalid_annotation types/actors/hero.json $.schema.properties.rank["x-kind"]',
      'error invalid_default types/actors/hero.json $.schema.properties.speed.default',
      'error invalid_default types/actors/hero.json $.schema.properties.tags.default',
      'error invalid_default types/actors/hero.json $.schema.properties.bag.default',
      'error invalid_default types/actors/hero.json $.schema.properties.nick.default',
    ],
  },
  {
    name: 'names that are not valid',
    change: (f: PluginFixture): void => {
      at(f, 'rolls.json')['my roll'] = { formula: '1d20' };
      at(f, 'dice.json').dx = { faces: [1] };
      f['cards/My Card.json'] = { title: 't', rows: [] };
      f['lang/english.json'] = {};
    },
    issues: [
      'error invalid_name rolls.json $["my roll"]',
      'error invalid_name dice.json $.dx',
      'error invalid_name cards/My Card.json $',
      'error invalid_name lang/english.json $',
      'warning unlisted_locale lang/english.json $',
    ],
  },
  {
    name: 'hasCode without a code folder',
    change: (f: PluginFixture): void => {
      at(f, 'plugin.json').hasCode = true;
    },
    issues: ['error has_code_mismatch plugin.json $.hasCode'],
  },
  {
    name: 'a code folder without hasCode, and features that need code',
    change: (f: PluginFixture): void => {
      f['code/client.js'] = '';
      sheetChildren(f).push({ type: 'custom:hpBar' });
      at(f, 'rolls.json').attack = { handler: 'attack' };
    },
    issues: [
      'error has_code_mismatch plugin.json $.hasCode',
      'error code_required sheets/hero.json $.layout.children[5].type',
      'error code_required rolls.json $.attack.handler',
    ],
  },
  {
    name: 'code with custom nodes, handlers and shared functions',
    change: (f: PluginFixture): void => {
      at(f, 'plugin.json').hasCode = true;
      f['code/client.js'] = '';
      sheetChildren(f).push({ type: 'custom:hpBar', props: { max: 10 } });
      at(f, 'rolls.json').attack = { handler: 'attack' };
      at(f, 'types/actors/hero.json', 'derived').mod = 'halve(@str)';
    },
    issues: [],
    valid: true,
  },
  {
    name: 'missing translations',
    change: (f: PluginFixture): void => {
      f['lang/en.json'] = { ...LANG, 'card.total': undefined };
      f['lang/pt-BR.json'] = { ...LANG, 'outcome.no': undefined };
    },
    issues: [
      'error missing_lang_key cards/roll.json $.rows[0].label',
      'warning missing_lang_key rolls.json $.skill.outcomes[1].label',
    ],
  },
  {
    name: 'a missing translation outside English only warns',
    change: (f: PluginFixture): void => {
      f['lang/pt-BR.json'] = { ...LANG, 'type.hero': undefined };
    },
    issues: ['warning missing_lang_key types/actors/hero.json $.label'],
    valid: true,
  },
  {
    name: 'lang files without English, and locales without files',
    change: (f: PluginFixture): void => {
      delete f['lang/en.json'];
      Object.assign(at(f, 'plugin.json'), { locales: ['pt-BR', 'es'], defaultLocale: 'fr' });
    },
    issues: [
      'error missing_lang_file lang/en.json $',
      'error missing_lang_file lang/es.json $',
      'error unlisted_locale plugin.json $.defaultLocale',
    ],
  },
  {
    name: 'styles that reach outside the sheet, or do not parse',
    change: (f: PluginFixture): void => {
      f['styles/sheet.css'] = "@import 'x.css';\nbody { margin: 0 }";
      f['styles/broken.css'] = '.a {';
    },
    issues: [
      'warning css_stripped styles/sheet.css $',
      'warning css_stripped styles/sheet.css $',
      'error css_invalid styles/broken.css $',
    ],
  },
  {
    name: 'files the format does not know',
    change: (f: PluginFixture): void => {
      f['notes/monsters.json'] = [];
      f['art/portrait.png'] = '';
    },
    issues: ['warning unknown_file notes/monsters.json $'],
    valid: true,
  },
];
