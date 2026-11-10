import type { RollOptions } from '../domain/rolls.js';
import {
  adjustEntityCounter,
  heldItemsOf,
  liveDataOf,
  setEntityField,
} from '../realtime/collab.js';

import type { AppContext } from './app.js';

/** What rolls need from the app: plugins, their code and live sheets (ADR-025, ADR-047). */
export function rollOptions({ app, db, now, rng, plugins, collab }: AppContext): RollOptions {
  const definition = (id: string) => plugins.definition(id);
  return {
    now,
    rng,
    logger: app.log,
    definition,
    liveData: liveDataOf({ collab, db }, definition),
    heldItems: heldItemsOf({ collab, db }, definition),
    code: (id) => plugins.code(id),
    adjust: adjustEntityCounter({ collab, db }, definition),
    setField: setEntityField({ collab, db }, definition),
  };
}
