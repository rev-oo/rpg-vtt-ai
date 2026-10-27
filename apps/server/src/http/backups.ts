import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

import type { BackupSchedule } from '../config/index.js';
import { backupDataDir, listBackups, pruneBackups } from '../db/backup.js';

/** How often the schedule looks for a backup that is due; the interval is at least an hour. */
export const BACKUP_CHECK_MS = 15 * 60 * 1000;

interface BackupOptions {
  dataDir: string;
  backup: BackupSchedule;
  now: () => Date;
  log: Pick<FastifyBaseLogger, 'info' | 'error'>;
}

/**
 * Takes a backup when the newest one in the folder is an interval old, or there is none, then
 * removes all but the newest `keep` (FR-ADMIN-05, ADR-055). It reads the folder each time, so
 * restarting the server neither skips a backup nor takes an extra one.
 */
export function runDueBackup({ dataDir, backup, now, log }: BackupOptions): void {
  try {
    const at = now();
    const newest = listBackups(backup.dir).at(-1);
    if (newest && at.getTime() - newest.takenAt.getTime() < backup.intervalMs) return;
    const result = backupDataDir(dataDir, backup.dir, at);
    const removed = pruneBackups(backup.dir, backup.keep);
    log.info({ ...result, removed }, 'scheduled backup written');
  } catch (error) {
    log.error({ err: error }, 'scheduled backup failed');
  }
}

/** Starts the schedule: a check now, then every 15 minutes. Returns how to stop it. */
export function startBackups(options: BackupOptions): () => void {
  runDueBackup(options);
  // Never keeps the process alive on its own.
  const timer = setInterval(() => {
    runDueBackup(options);
  }, BACKUP_CHECK_MS).unref();
  return () => {
    clearInterval(timer);
  };
}

/** Runs scheduled backups while the server is up, when `BACKUP_DIR` is set. */
export function scheduleBackups(
  app: FastifyInstance,
  {
    dataDir,
    backup,
    now,
  }: Omit<BackupOptions, 'log' | 'backup'> & { backup: BackupSchedule | undefined },
): void {
  if (!backup) return;
  let stop: (() => void) | undefined;
  app.addHook('onReady', (done) => {
    app.log.info(
      { dir: backup.dir, intervalMs: backup.intervalMs, keep: backup.keep },
      'scheduled backups on',
    );
    stop = startBackups({ dataDir, backup, now, log: app.log });
    done();
  });
  app.addHook('onClose', (_instance, done) => {
    stop?.();
    done();
  });
}
