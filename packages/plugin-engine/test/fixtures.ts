import type { Rng } from '@vtt/formula';
import type { ActorType, PluginDefinition } from '@vtt/plugin-schema';

/** Rolls the given faces in order (1-based), then fails the test if asked for more. */
export function scripted(...faces: number[]): Rng {
  const queue = [...faces];
  return {
    nextInt: (sides) => {
      const face = queue.shift();
      if (face === undefined || face > sides)
        throw new Error(`no scripted face for d${String(sides)}`);
      return face - 1;
    },
  };
}

export const CHARACTER: ActorType = {
  label: 'type.character',
  controlledBy: 'player',
  sheet: 'character',
  schema: {
    type: 'object',
    properties: {
      str: { type: 'integer', default: 14 },
      dex: { type: 'integer' },
      hp: {
        type: 'object',
        properties: {
          value: { type: 'integer', default: 10, 'x-counter': true },
          max: { type: 'integer', default: 10 },
        },
      },
      skills: {
        type: 'array',
        'x-kind': 'collection',
        default: [{ name: 'Climb', rank: 2 }],
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rank: { type: 'integer', default: 0 },
            secretBonus: { type: 'integer', 'x-layer': 'secret' },
          },
        },
      },
      tags: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string', 'x-kind': 'longText' },
      portrait: { type: 'string', 'x-kind': 'image' },
      gmNotes: { type: 'string', 'x-kind': 'longText', 'x-layer': 'secret' },
      alive: { type: 'boolean' },
    },
  },
  derived: {
    // Listed before what it reads, so order of evaluation is tested.
    attack: '@derived.strMod + @settings.bonus',
    strMod: 'floor((@str - 10) / 2)',
    skillTotal: 'sum(@skills[*].rank)',
  },
};

export const PLUGIN: PluginDefinition = {
  manifest: {
    id: 'tiny-test',
    name: 'Tiny Test',
    version: '1.0.0',
    kind: 'system',
    coreApi: '^0.1.0',
    hasCode: false,
  },
  actorTypes: { character: CHARACTER },
  itemTypes: {
    weapon: {
      label: 'type.weapon',
      sheet: 'weapon',
      schema: { type: 'object', properties: { damage: { type: 'string', default: '1d6' } } },
    },
  },
  sheets: {},
  rolls: {
    skill: {
      label: 'roll.skill',
      formula: '1d20 + @derived.strMod + @skills[@args.id].rank',
      outcomes: [
        { when: '@total >= 20', label: 'outcome.critical', class: 'crit' },
        { when: '@total >= 15', label: 'outcome.success', class: 'ok' },
        { label: 'outcome.failure', class: 'fail' },
      ],
      card: 'skill',
    },
    plain: { formula: '1d6' },
    lostCard: { label: 'roll.lost', formula: '1d6 + 1', card: 'gone' },
    fate: { formula: '4dF' },
    attack: { handler: 'attack' },
  },
  dice: {
    dF: { faces: ['-', ' ', '+'], values: { '-': -1, ' ': 0, '+': 1 } },
  },
  cards: {
    skill: {
      title: 'card.skill.title',
      rows: [
        { label: 'card.roll', value: '@roll.expression' },
        { label: 'card.total', value: '@total', class: 'total' },
        { label: 'card.skill', value: '@skills[@args.id].name' },
        { label: 'card.broken', value: '@nope' },
      ],
      outcome: true,
    },
  },
  settings: {
    bonus: { type: 'integer', label: 'setting.bonus', default: 1, minimum: 0, maximum: 5 },
  },
  lang: {},
  styles: [],
};
