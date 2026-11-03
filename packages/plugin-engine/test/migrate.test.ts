import { describe, expect, it } from 'vitest';

import type { FieldSchema, MigrationStep } from '@vtt/plugin-schema';

import { dataIssues, MigrationStepFailure, runMigrationSteps } from '../src/index.js';

// T-1501 (FR-PLUGIN-12, ADR-072): declarative migration steps on an entity's stored data.

const hero = { kind: 'actor', type: 'hero' } as const;
const step = <T extends MigrationStep['op']>(
  op: T,
  rest: Omit<Extract<MigrationStep, { op: T }>, 'op' | 'kind' | 'type'>,
): MigrationStep => ({ op, ...hero, ...rest }) as MigrationStep;

describe('runMigrationSteps', () => {
  it('renames, moves, sets defaults and drops, in order', () => {
    const data = { strength: 12, health: 7, mana: 3, stats: { dex: 2 } };
    const result = runMigrationSteps(
      data,
      [
        step('rename', { path: 'strength', to: 'str' }),
        step('move', { path: 'health', to: 'hp.value' }),
        step('rename', { path: 'stats.dex', to: 'agility' }),
        step('setDefault', { path: 'level', value: 1 }),
        step('setDefault', { path: 'str', value: 99 }),
        step('drop', { path: 'mana' }),
      ],
      hero,
    );
    expect(result).toEqual({ str: 12, hp: { value: 7 }, stats: { agility: 2 }, level: 1 });
    // The data it was given is left as it was.
    expect(data).toEqual({ strength: 12, health: 7, mana: 3, stats: { dex: 2 } });
  });

  it('runs on every row of a collection, keeping each value in its row', () => {
    const data = {
      skills: { a: { name: 'Climb', lvl: 2, sort: 'a0' }, b: { name: 'Swim', sort: 'a1' } },
    };
    const result = runMigrationSteps(
      data,
      [
        step('move', { path: 'skills.*.lvl', to: 'skills.*.rank' }),
        step('setDefault', { path: 'skills.*.rank', value: 0 }),
        step('drop', { path: 'skills.*.name' }),
      ],
      hero,
    );
    expect(result).toEqual({
      skills: { a: { rank: 2, sort: 'a0' }, b: { rank: 0, sort: 'a1' } },
    });
  });

  it('leaves entities without the field alone, and skips other types', () => {
    const data = { str: 10 };
    expect(
      runMigrationSteps(
        data,
        [
          step('rename', { path: 'missing.deep', to: 'other' }),
          step('drop', { path: 'skills.*.name' }),
          { op: 'drop', kind: 'actor', type: 'monster', path: 'str' },
          { op: 'drop', kind: 'item', type: 'hero', path: 'str' },
        ],
        hero,
      ),
    ).toEqual({ str: 10 });
  });

  it('replaces a value already at the target, which a newer schema may have made', () => {
    const result = runMigrationSteps(
      { notes: 'Old notes', bio: '' },
      [step('rename', { path: 'notes', to: 'bio' })],
      hero,
    );
    expect(result).toEqual({ bio: 'Old notes' });
  });

  it('fails at the step that meets a value that is not an object', () => {
    const run = () =>
      runMigrationSteps(
        { hp: 5, str: 10 },
        [
          step('rename', { path: 'str', to: 'strength' }),
          step('move', { path: 'strength', to: 'hp.max' }),
        ],
        hero,
      );
    expect(run).toThrow(MigrationStepFailure);
    expect(run).toThrow(expect.objectContaining({ step: 1, path: 'hp' }) as Error);
  });
});

describe('dataIssues', () => {
  const schema: FieldSchema = {
    type: 'object',
    properties: {
      str: { type: 'integer', minimum: 1, maximum: 30 },
      notes: { type: 'string', 'x-kind': 'longText' },
      gm: { type: 'string', 'x-layer': 'secret' },
      skills: {
        type: 'array',
        'x-kind': 'collection',
        items: { type: 'object', properties: { rank: { type: 'integer' } } },
      },
    },
  };

  it('accepts data that fits, with missing fields and keys the schema does not know', () => {
    expect(
      dataIssues(schema, { str: 5, notes: 'Hi', skills: { a: { rank: 1 } }, extra: true }),
    ).toEqual([]);
  });

  it('lists what the store would repair, in both layers and in rows', () => {
    expect(dataIssues(schema, { str: 99, gm: 4, skills: { a: { rank: 'high' } } })).toEqual([
      { path: ['str'], reason: 'maximum' },
      { path: ['skills', 'a', 'rank'], reason: 'type' },
      { path: ['gm'], reason: 'type' },
    ]);
  });
});
