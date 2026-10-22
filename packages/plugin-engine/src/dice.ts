import type { CustomDie } from '@vtt/formula';
import type { Die } from '@vtt/plugin-schema';

const NUMERIC = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * A plugin die as the formula engine rolls it (specs §8.8). A text face counts as its entry
 * in `values`, or as the number it spells (`"3"`), or 0; `"+"` and `"-"` need `values`.
 */
export function toCustomDie(die: Die): CustomDie {
  return {
    faces: die.faces.map((face) => {
      if (typeof face === 'number') return { label: String(face), value: face };
      if (typeof face === 'object') return face;
      const mapped = die.values && Object.hasOwn(die.values, face) ? die.values[face] : undefined;
      return { label: face, value: mapped ?? (NUMERIC.test(face.trim()) ? Number(face) : 0) };
    }),
  };
}

export function toCustomDice(dice: Readonly<Record<string, Die>>): Record<string, CustomDie> {
  return Object.fromEntries(Object.entries(dice).map(([name, die]) => [name, toCustomDie(die)]));
}
