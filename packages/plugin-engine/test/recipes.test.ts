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
