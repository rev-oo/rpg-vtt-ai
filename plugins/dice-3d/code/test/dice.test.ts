import { describe, expect, it } from 'vitest';

import { diceFor, diceOf, type RolledMessage } from '../src/dice.js';

const message = (
  terms: { die: string; results: { value: number; active?: boolean; label?: string }[] }[],
  senderId = 'me',
): RolledMessage => ({
  senderId,
  rolls: [
    {
      dice: terms.map(({ die, results }) => ({
        die,
        results: results.map(({ value, active = true, label }) => ({
          value,
          active,
          ...(label !== undefined && { label }),
        })),
      })),
    },
  ],
});

const choice = { viewerId: 'me', showOthers: true, maxDice: 20 };

describe('diceFor', () => {
  it('throws one die of the standard sizes, showing the result', () => {
    expect(diceFor('d20', 17, true)).toEqual([
      expect.objectContaining({ shape: 'd20', top: '17', active: true }),
    ]);
    expect(diceFor('d6', 6, false)[0]?.labels).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('throws a d100 as a tens die and a units die', () => {
    const tops = (value: number): string[] => diceFor('d100', value, true).map((die) => die.top);
    expect(tops(57)).toEqual(['50', '7']);
    expect(tops(60)).toEqual(['60', '0']);
    expect(tops(5)).toEqual(['00', '5']);
    expect(tops(100)).toEqual(['00', '0']);
    expect(diceFor('d100', 1, true).every((die) => die.shape === 'd10')).toBe(true);
  });

  it('leaves out sizes it has no shape for, and impossible results', () => {
    expect(diceFor('d3', 2, true)).toEqual([]);
    expect(diceFor('d7', 2, true)).toEqual([]);
    expect(diceFor('d6', 7, true)).toEqual([]);
    expect(diceFor('d100', 0, true)).toEqual([]);
  });
});

describe('diceOf', () => {
  it("throws every result of the message's rolls, dropped ones dimmed", () => {
    const dice = diceOf(
      message([
        { die: 'd20', results: [{ value: 3, active: false }, { value: 18 }] },
        { die: 'd6', results: [{ value: 4 }] },
      ]),
      choice,
    );
    expect(dice.map((die) => [die.shape, die.top, die.active])).toEqual([
      ['d20', '3', false],
      ['d20', '18', true],
      ['d6', '4', true],
    ]);
  });

  it("throws the system's custom dice as the shape with as many faces (T-1612)", () => {
    const fate = message([
      {
        die: 'dF',
        results: [
          { value: 1, label: '+' },
          { value: -1, label: '-', active: false },
        ],
      },
    ]);
    const labels = ['-', '-', ' ', ' ', '+', '+'];
    const dF = { faces: labels.map((label) => ({ label })) };
    expect(diceOf(fate, choice, { dF })).toEqual([
      { shape: 'd6', top: '+', labels, active: true },
      { shape: 'd6', top: '-', labels, active: false },
    ]);
    // Unknown to the module, or with no shape of that many faces, a custom die is left out.
    expect(diceOf(fate, choice)).toEqual([]);
    expect(diceOf(fate, choice, { dF: { faces: [{ label: '+' }, { label: '-' }] } })).toEqual([]);
    // A system die keeps its own faces, even one named like a standard die.
    const odd = message([{ die: 'd4', results: [{ value: 2, label: 'b' }] }]);
    const d4 = { faces: ['a', 'b', 'c', 'd'].map((label) => ({ label })) };
    expect(diceOf(odd, choice, { d4 }).map((die) => die.top)).toEqual(['b']);
  });

  it("skips other people's rolls when the viewer asks", () => {
    const theirs = message([{ die: 'd20', results: [{ value: 3 }] }], 'them');
    expect(diceOf(theirs, { ...choice, showOthers: false })).toEqual([]);
    expect(diceOf(theirs, choice)).toHaveLength(1);
  });

  it('throws at most maxDice, never half a d100', () => {
    const many = message([
      { die: 'd6', results: [{ value: 1 }, { value: 2 }] },
      { die: 'd100', results: [{ value: 42 }] },
    ]);
    expect(diceOf(many, { ...choice, maxDice: 3 })).toHaveLength(2);
    expect(diceOf(many, { ...choice, maxDice: 4 })).toHaveLength(4);
  });
});
