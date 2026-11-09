// dnd5e-srd's server code (specs §8.10): death saves and rests, packed by `vtt-plugin pack`.
import { defineServer } from '@vtt/sdk';

import { deathSave, longRest, spendHitDie } from './src/rests.js';

export default defineServer({
  handlers: { deathSave, spendHitDie, longRest },
});
