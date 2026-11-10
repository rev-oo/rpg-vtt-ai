// dnd5e-srd's server code (specs §8.10): death saves, rests and spell slots, packed by
// `vtt-plugin pack`.
import { defineServer } from '@vtt/sdk';

import { deathSave, longRest, spendHitDie, spendSlot } from './src/rests.js';

export default defineServer({
  handlers: { deathSave, spendHitDie, longRest, spendSlot },
});
