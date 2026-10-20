import type { FastifyInstance } from 'fastify';

import type { Db } from '../db/client.js';
import { purgeDeletedEntities } from '../db/repositories/index.js';

export const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Permanently removes trashed entities once their retention window closes (FR-ENT-04): at
 * startup, then every few hours while the server runs.
 */
export function scheduleTrashPurge(
  app: FastifyInstance,
  { db, retentionMs, now }: { db: Db; retentionMs: number; now: () => Date },
): void {
  const purge = () => {
    try {
      const purged = purgeDeletedEntities(db, { now: now(), retentionMs });
      if (purged.actors + purged.items + purged.journalEntries > 0) {
        app.log.info({ purged }, 'purged expired trash');
      }
    } catch (error) {
      app.log.error({ err: error }, 'trash purge failed');
    }
  };

  let timer: NodeJS.Timeout | undefined;
  app.addHook('onReady', (done) => {
    purge();
    // Never keeps the process alive on its own.
    timer = setInterval(purge, PURGE_INTERVAL_MS).unref();
    done();
  });
  app.addHook('onClose', (_instance, done) => {
    clearInterval(timer);
    done();
  });
}
