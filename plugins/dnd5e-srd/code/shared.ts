// dnd5e-srd's formula functions (specs §8.9): class tables and text that formulas cannot
// express on their own. They run in QuickJS in the browser and on the server.
import { defineShared } from '@vtt/sdk';

import { abilityName, damageText, slotsFor } from './src/tables.js';

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export default defineShared({
  functions: {
    /** `slots(@class, @level, 3)`: the character's level 3 spell slots. */
    slots: (classKey, level, slotLevel) => slotsFor(str(classKey), num(level), num(slotLevel)),
    /** `damage(@item.dice, @item.derived.die, 3)`: `1d8 + 3`. */
    damage: (count, die, bonus) => damageText(num(count), num(die), num(bonus)),
    /** `saveText(@item.save, @derived.spellDc)`: `Dexterity DC 13`. */
    saveText: (ability, dc) => `${abilityName(str(ability))} DC ${String(num(dc))}`,
  },
});
