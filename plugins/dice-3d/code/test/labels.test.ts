import { describe, expect, it } from 'vitest';

import { diceFor } from '../src/dice.js';
import { labelsFor } from '../src/labels.js';

describe('labelsFor', () => {
  it('puts the result on the top face and keeps every label once', () => {
    const [die] = diceFor('d20', 17, true);
    if (!die) throw new Error('no die');
    for (const top of [0, 7, 16, 19]) {
      const labels = labelsFor(die, top);
      expect(labels[top]).toBe('17');
      expect(labels.toSorted()).toEqual(die.labels.toSorted());
    }
  });

  it("labels a d4's corners", () => {
    const [die] = diceFor('d4', 3, true);
    if (!die) throw new Error('no die');
    const labels = labelsFor(die, 1);
    expect(labels).toHaveLength(4);
    expect(labels[1]).toBe('3');
  });

  it('labels the two dice of a d100', () => {
    const [tens, units] = diceFor('d100', 73, true);
    if (!tens || !units) throw new Error('no dice');
    expect(labelsFor(tens, 4)[4]).toBe('70');
    expect(labelsFor(units, 9)[9]).toBe('3');
  });
});
