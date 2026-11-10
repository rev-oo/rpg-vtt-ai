// srd5's formula functions (specs §8.9): class tables, which formulas cannot hold. They run in
// QuickJS in the browser and on the server.
import { defineShared } from '@vtt/sdk';

import { slotsFor } from './src/tables.js';

const num = (value: unknown): number => (typeof value === 'number' ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export default defineShared({
  functions: {
    /** `slots(@class, @level, 3)`: the character's level 3 spell slots. */
    slots: (classKey, level, slotLevel) => slotsFor(str(classKey), num(level), num(slotLevel)),
  },
});
