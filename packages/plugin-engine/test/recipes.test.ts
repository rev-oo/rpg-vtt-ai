import { describe, expect, it } from 'vitest';

import { chatCardView, rollRecipe, type RecipeResult } from '../src/index.js';

import { PLUGIN, scripted } from './fixtures.js';

const scope = {
  str: 14,
  skills: { climb: { name: 'Climb', rank: 2, sort: 'a0' } },
  derived: { strMod: 2 },
  settings: {},
  args: { id: 'climb' },
};
const skill = PLUGIN.rolls.skill;
if (!skill || !('formula' in skill)) throw new Error('fixture');

const rollSkill = (face: number, cards = PLUGIN.cards): RecipeResult =>
  rollRecipe('skill', skill, { scope, rng: scripted(face), cards });

describe('rollRecipe() (specs §8.7)', () => {
  it('rolls against the actor and checks outcomes in order', () => {
    // 16 + 2 + 2 = 20 matches both the first and second outcome; the first wins.
    const critical = rollSkill(16);
    expect(critical.roll).toMatchObject({ resolved: '1d20 + 2 + 2', total: 20 });
    expect(critical.outcome).toEqual({ index: 0, label: 'outcome.critical', class: 'crit' });

    expect(rollSkill(12).outcome).toEqual({ index: 1, label: 'outcome.success', class: 'ok' });
    // No `when` is the fallback.
    expect(rollSkill(1).outcome).toEqual({ index: 2, label: 'outcome.failure', class: 'fail' });
    expect(critical.label).toBe('roll.skill');
    expect(critical.problems).toEqual([]);
  });

  it('has no outcome when none matches or there are none', () => {
    const plain = rollRecipe('plain', { formula: '1d6' }, { scope, rng: scripted(3), cards: {} });
    expect(plain.outcome).toBeNull();
    expect(plain.card).toBeUndefined();
    const none = rollRecipe(
      'x',
      { formula: '1d6', outcomes: [{ when: '@total > 6', label: 'never' }] },
      { scope, rng: scripted(3), cards: {} },
    );
    expect(none.outcome).toBeNull();
  });

  it('skips outcomes that fail or are not true/false, and says why', () => {
    const result = rollRecipe(
      'x',
      {
        formula: '1d6',
        outcomes: [
          { when: '@nope > 1', label: 'broken' },
          { when: '@total', label: 'number' },
          { label: 'fallback' },
        ],
      },
      { scope, rng: scripted(4), cards: {} },
    );
    expect(result.outcome?.label).toBe('fallback');
    expect(result.problems.map((problem) => [problem.at, problem.code])).toEqual([
      ['outcomes[0].when', 'unknown_reference'],
      ['outcomes[1].when', 'type_error'],
    ]);
  });

  it('resolves the card from the roll', () => {
    const { card } = rollSkill(12);
    expect(card).toEqual({
      name: 'skill',
      title: 'card.skill.title',
      outcome: true,
      rows: [
        { label: 'card.roll', value: '1d20 + @derived.strMod + @skills[@args.id].rank' },
        { label: 'card.total', value: '16', class: 'total' },
        { label: 'card.skill', value: 'Climb' },
        {
          label: 'card.broken',
          value: '',
          error: expect.stringContaining('@nope') as unknown as string,
        },
      ],
    });
  });

  it('works out card actions when the roll is made (T-1617)', () => {
    const cards = {
      hit: {
        title: 'Hit',
        rows: [],
        actions: [
          { label: 'Take', field: 'hp.value', amount: '-@total / 2' },
          { label: 'Heal', field: 'hp.value', amount: '@total', when: '@total > 100' },
          { label: 'Save', roll: 'save', args: { dc: '10 + @derived.strMod', who: '@args.id' } },
          { label: 'Broken', field: 'hp.value', amount: '@nope' },
          { label: 'Not a number', field: 'hp.value', amount: "'many'" },
          { label: 'Bad arg', roll: 'save', args: { dc: '@nope' } },
          { label: 'Hidden', roll: 'save', when: '@nope' },
        ],
      },
    };
    const { card } = rollRecipe(
      'hit',
      { formula: '1d20', card: 'hit' },
      {
        scope,
        rng: scripted(7),
        cards,
      },
    );
    expect(card?.actions).toEqual([
      // -3.5, rounded as `round()` does.
      { kind: 'apply', label: 'Take', field: 'hp.value', amount: -3 },
      { kind: 'roll', label: 'Save', roll: 'save', args: { dc: 12, who: 'climb' } },
      {
        kind: 'apply',
        label: 'Broken',
        field: 'hp.value',
        amount: 0,
        error: expect.stringContaining('nope') as unknown,
      },
      {
        kind: 'apply',
        label: 'Not a number',
        field: 'hp.value',
        amount: 0,
        error: 'Expected a number, got many',
      },
      {
        kind: 'roll',
        label: 'Bad arg',
        roll: 'save',
        args: {},
        error: expect.stringContaining('nope') as unknown,
      },
    ]);
    // A card without actions resolves none.
    expect(rollSkill(12).card).not.toHaveProperty('actions');
  });

  it('notes a card the plugin does not have', () => {
    const lost = PLUGIN.rolls.lostCard;
    if (!lost || !('formula' in lost)) throw new Error('fixture');
    const result = rollRecipe('lostCard', lost, { scope, rng: scripted(2), cards: PLUGIN.cards });
    expect(result.card).toBeUndefined();
    expect(result.problems).toEqual([
      { at: 'card', code: 'missing_card', message: 'There is no card named "gone"' },
    ]);
  });

  it('throws when the formula cannot be rolled', () => {
    expect(() =>
      rollRecipe('x', { formula: '1d20 + @nope' }, { scope, rng: scripted(1), cards: {} }),
    ).toThrow(/@nope/);
  });
});

describe('recipes with dice, named values and several rolls (T-1608)', () => {
  it('lets outcomes and cards read the natural d20 and the kept dice', () => {
    const result = rollRecipe(
      'attack',
      {
        formula: '2d20kh1 + 1d4 + 5',
        outcomes: [{ when: '@roll.natural == 20', label: 'crit' }, { label: 'hit' }],
        card: 'dice',
      },
      {
        scope,
        rng: scripted(20, 3, 2),
        cards: {
          dice: {
            title: 'Dice',
            rows: [
              { label: 'natural', value: '@roll.natural' },
              { label: 'kept', value: 'sum(@roll.dice[1].kept[*])' },
              { label: 'terms', value: "@roll.dice[0].formula + ' ' + @roll.dice[1].die" },
            ],
          },
        },
      },
    );
    expect(result.outcome?.label).toBe('crit');
    expect(result.card?.rows.map((row) => row.value)).toEqual(['20', '2', '2d20kh1 d4']);
  });

  it('has no natural without a d20', () => {
    const result = rollRecipe(
      'damage',
      { formula: '1d6', outcomes: [{ when: '@roll.natural == 20', label: 'never' }] },
      { scope, rng: scripted(6), cards: {} },
    );
    expect(result.outcome).toBeNull();
    expect(result.problems.map((problem) => problem.code)).toEqual(['unknown_reference']);
  });

  it('works out named values first, then rolls named formulas in order', () => {
    const result = rollRecipe(
      'strike',
      {
        let: { bonus: '@derived.strMod + 1', twice: '@let.bonus * 2' },
        formula: {
          attack: '1d20 + @let.bonus',
          damage: '(@rolls.attack.natural == 20 ? 2 : 1)d6 + @let.twice',
        },
        outcomes: [{ when: '@rolls.attack.natural == 20', label: 'crit' }],
        card: 'strike',
      },
      {
        scope,
        rng: scripted(20, 4, 5),
        cards: {
          strike: {
            title: 'Strike',
            rows: [
              { label: 'attack', value: '@total' },
              { label: 'damage', value: '@rolls.damage.total' },
              { label: 'bonus', value: '@let.twice' },
            ],
          },
        },
      },
    );
    expect(result.rolls.map((rolled) => rolled.resolved)).toEqual(['1d20 + 3', '2d6 + 6']);
    expect(result.roll).toBe(result.rolls[0]);
    expect(result.outcome?.label).toBe('crit');
    expect(result.card?.rows.map((row) => row.value)).toEqual(['23', '15', '6']);
    expect(chatCardView(result, { hasTemplate: () => false })).toEqual({
      kind: 'text',
      text: 'strike: 1d20 + 3 = 23; 2d6 + 6 = 15 (crit)',
    });
  });

  it('fails the roll when a named value fails', () => {
    expect(() =>
      rollRecipe(
        'x',
        { let: { a: '@nope' }, formula: '1d6' },
        { scope, rng: scripted(), cards: {} },
      ),
    ).toThrow('@nope does not exist');
  });
});

describe('chatCardView() (FR-CHAT-06)', () => {
  const always = { hasTemplate: () => true };

  it('shows the card while its template exists', () => {
    const result = rollSkill(12);
    expect(chatCardView(result, always)).toEqual({ kind: 'card', card: result.card });
  });

  it('falls back to plain text when the template is gone', () => {
    const result = rollSkill(12);
    const t = (text: string) =>
      ({ 'roll.skill': 'Skill', 'outcome.success': 'Success' })[text] ?? text;
    expect(chatCardView(result, { hasTemplate: () => false, translate: t })).toEqual({
      kind: 'text',
      text: 'Skill: 1d20 + 2 + 2 = 16 (Success)',
    });
    // Untranslated, as when the plugin and its lang files are gone.
    expect(chatCardView(result, { hasTemplate: () => false })).toEqual({
      kind: 'text',
      text: 'roll.skill: 1d20 + 2 + 2 = 16 (outcome.success)',
    });
  });

  it('falls back for recipes whose card was missing at roll time, or that have none', () => {
    const lost = PLUGIN.rolls.lostCard;
    if (!lost || !('formula' in lost)) throw new Error('fixture');
    const result = rollRecipe('lostCard', lost, { scope, rng: scripted(2), cards: PLUGIN.cards });
    expect(chatCardView(result, always)).toEqual({ kind: 'text', text: 'roll.lost: 1d6 + 1 = 3' });

    const constant = rollRecipe('flat', { formula: '5' }, { scope, rng: scripted(), cards: {} });
    expect(chatCardView(constant, always)).toEqual({ kind: 'text', text: 'flat: 5' });
  });
});
