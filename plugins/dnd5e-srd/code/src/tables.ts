// Class tables from SRD 5.2, which formulas cannot hold (no lists or lookups): shared by the
// `slots` formula function and the Long Rest handler, which sees no derived values.

const FULL_CASTERS = new Set([
  'class.bard',
  'class.cleric',
  'class.druid',
  'class.sorcerer',
  'class.wizard',
]);
const HALF_CASTERS = new Set(['class.paladin', 'class.ranger']);

/** Spell slots by slot level (index 0 is level 1) for a full caster of each level 1–20. */
const FULL_CASTER_SLOTS: readonly (readonly number[])[] = [
  [2],
  [3],
  [4, 2],
  [4, 3],
  [4, 3, 2],
  [4, 3, 3],
  [4, 3, 3, 1],
  [4, 3, 3, 2],
  [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

/** Pact Magic: how many slots, and their level, for a warlock of each level 1–20. */
function pactSlots(level: number): { count: number; slotLevel: number } {
  if (level >= 17) return { count: 4, slotLevel: 5 };
  if (level >= 11) return { count: 3, slotLevel: 5 };
  return { count: level === 1 ? 1 : 2, slotLevel: Math.min(5, Math.ceil(level / 2)) };
}

const clampLevel = (level: number): number => Math.min(20, Math.max(1, Math.floor(level)));

/**
 * The spell slots of `slotLevel` a single-class character of `classKey` and `level` has.
 * Half casters (paladin, ranger) use the full caster table at half their level, rounded up.
 */
export function slotsFor(classKey: string, level: number, slotLevel: number): number {
  const at = clampLevel(level);
  if (classKey === 'class.warlock') {
    const pact = pactSlots(at);
    return pact.slotLevel === slotLevel ? pact.count : 0;
  }
  const casterLevel = FULL_CASTERS.has(classKey)
    ? at
    : HALF_CASTERS.has(classKey)
      ? Math.ceil(at / 2)
      : 0;
  if (casterLevel === 0) return 0;
  return FULL_CASTER_SLOTS[casterLevel - 1]?.[slotLevel - 1] ?? 0;
}

/** A class's Hit Die size. */
export function hitDieOf(classKey: string): number {
  switch (classKey) {
    case 'class.barbarian':
      return 12;
    case 'class.fighter':
    case 'class.paladin':
    case 'class.ranger':
      return 10;
    case 'class.sorcerer':
    case 'class.wizard':
      return 6;
    default:
      return 8;
  }
}

const ABILITY_NAMES: Readonly<Record<string, string>> = {
  'ability.str': 'Strength',
  'ability.dex': 'Dexterity',
  'ability.con': 'Constitution',
  'ability.int': 'Intelligence',
  'ability.wis': 'Wisdom',
  'ability.cha': 'Charisma',
};

/** An ability's English name from its lang key: card rows show values untranslated. */
export function abilityName(key: string): string {
  return Object.hasOwn(ABILITY_NAMES, key) ? (ABILITY_NAMES[key] ?? key) : key;
}

/** `2d6 + 3`, `1d8`, `1d4 − 1`: formulas cannot turn numbers into text. */
export function damageText(count: number, die: number, bonus: number): string {
  const dice = `${String(count)}d${String(die)}`;
  if (bonus === 0) return dice;
  return `${dice} ${bonus > 0 ? '+' : '−'} ${String(Math.abs(bonus))}`;
}
