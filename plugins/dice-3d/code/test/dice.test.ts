import { describe, expect, it } from 'vitest';

import { diceOf, MAX_DICE, printLabel, type ChatMessage } from '../src/dice.js';

type Roll = ChatMessage['rolls'][number];

const roll = (die: string, values: number[], dropped: number[] = []): Roll => ({
  expression: `${String(values.length)}${die}`,
  resolved: `${String(values.length)}${die}`,
  total: values.reduce((a, b) => a + b, 0),
  dice: [
    {
      formula: `${String(values.length)}${die}`,
      count: values.length,
      die,
      results: values.map((value, i) => ({
        value,
        active: !dropped.includes(i),
        ...(dropped.includes(i) && { dropped: true as const }),
      })),
      total: 0,
    },
  ],
});

describe('dice of a message', () => {
  it('throws one die per result, dimming dice that do not count', () => {
    expect(diceOf([roll('d20', [17, 3], [1])])).toEqual([
      { sides: 20, label: 17, print: 'plain', dim: false },
      { sides: 20, label: 3, print: 'plain', dim: true },
    ]);
  });

  it('prints a d10 10 as 0', () => {
    expect(diceOf([roll('d10', [10, 4])])?.map((die) => die.label)).toEqual([0, 4]);
  });

  it('throws a tens and a units die for a d100', () => {
    expect(diceOf([roll('d100', [37, 100, 5])])).toEqual([
      { sides: 10, label: 3, print: 'tens', dim: false },
      { sides: 10, label: 7, print: 'units', dim: false },
      { sides: 10, label: 0, print: 'tens', dim: false },
      { sides: 10, label: 0, print: 'units', dim: false },
      { sides: 10, label: 0, print: 'tens', dim: false },
      { sides: 10, label: 5, print: 'units', dim: false },
    ]);
  });

  it('skips dice it has no shape for, and leaves too many dice to the chat', () => {
    expect(diceOf([roll('dF', [1, -1])])).toBeNull();
    expect(diceOf([roll('d3', [2])])).toBeNull();
    expect(diceOf([])).toBeNull();
    expect(
      diceOf([
        roll(
          'd6',
          Array.from({ length: MAX_DICE }, () => 1),
        ),
      ]),
    ).toHaveLength(MAX_DICE);
    expect(
      diceOf([
        roll(
          'd6',
          Array.from({ length: MAX_DICE + 1 }, () => 1),
        ),
      ]),
    ).toBeNull();
  });

  it('prints labels', () => {
    expect(printLabel(0, 'tens', 10)).toBe('00');
    expect(printLabel(7, 'tens', 10)).toBe('70');
    expect(printLabel(6, 'plain', 20)).toBe('6.');
    expect(printLabel(6, 'plain', 6)).toBe('6');
    expect(printLabel(9, 'units', 10)).toBe('9.');
  });
});
