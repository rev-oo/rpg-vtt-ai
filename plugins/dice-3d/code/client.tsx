// dice-3d's client code (T-1604): one overlay, packed with three.js and cannon-es by
// `vtt-plugin pack`.
import { defineClient } from '@vtt/sdk/client';

import { DiceOverlay } from './src/overlay.js';

export default defineClient({ overlays: { dice: { component: DiceOverlay } } });
