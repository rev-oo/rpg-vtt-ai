import { describe, expect, it } from 'vitest';

import { FormulaError, isDiceText, parseDice, print } from '../src/index.js';

describe('dice expressions kept as text (T-1607)', () => {
  it.each(['1d8', '2d6 + 1d4 + 3', '1d8 - 1', '-1', '4dF', '(2)d6 * 2', 'd(8)kh1', ' 3 '])(
    'accepts %s',
    (source) => {
      expect(isDiceText(source)).toBe(true);
    },
  );

  it.each(['@str', '1d6 + @str', 'max(1, 2)', "'1d6'", 'true', '1d6 > 3', '@a ? 1 : 2', '1d6 +'])(
    'refuses %s',
    (source) => {
      expect(isDiceText(source)).toBe(false);
      expect(() => parseDice(source)).toThrow(FormulaError);
    },
  );

  it('reads blank text as no dice', () => {
    expect(parseDice('')).toBeNull();
    expect(parseDice('  ')).toBeNull();
    expect(isDiceText('')).toBe(true);
  });

  it('points at the part that is not allowed', () => {
    expect(() => parseDice('1d6 + @str')).toThrow(
      expect.objectContaining({ code: 'not_dice', column: 7 }),
    );
    const tree = parseDice('2d6+3');
    expect(tree && print(tree)).toBe('2d6 + 3');
  });
});
