import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config/index.js';
import { openDatabase, runMigrations } from '../src/db/client.js';
import { BACKUP_CHECK_MS, startBackups } from '../src/http/backups.js';

// T-0808 (FR-ADMIN-05, ADR-055): scheduled backups, keeping the newest N.

const HOUR = 60 * 60 * 1000;
const log = { info: vi.fn(), error: vi.fn() };

function instance() {
  const root = mkdtempSync(path.join(tmpdir(), 'vtt-backups-'));
  const data = path.join(root, 'data');
  const db = openDatabase({ dataDir: data });
  runMigrations(db);
  return { data, backups: path.join(root, 'backups'), db };
}

const folders = (dir: string) => readdirSync(dir).sort();

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-27T03:00:00Z') });
  log.info.mockClear();
  log.error.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduled backups (T-0808)', () => {
  it('backs up on schedule and keeps the newest ones', () => {
    const { data, backups, db } = instance();
    // Not a backup: never removed.
    mkdirSync(path.join(backups, 'notes'), { recursive: true });
    const stop = startBackups({
      dataDir: data,
      backup: { dir: backups, intervalMs: 6 * HOUR, keep: 3 },
      now: () => new Date(),
      log,
    });

    // One at once, since there was none.
    expect(folders(backups)).toEqual(['notes', 'vtt-backup-2026-10-27T03-00-00Z']);
    vi.advanceTimersByTime(6 * HOUR - BACKUP_CHECK_MS);
    expect(folders(backups)).toHaveLength(2);
    vi.advanceTimersByTime(BACKUP_CHECK_MS);
    expect(folders(backups)).toContain('vtt-backup-2026-10-27T09-00-00Z');

    vi.advanceTimersByTime(18 * HOUR);
    expect(folders(backups)).toEqual([
      'notes',
      'vtt-backup-2026-10-27T15-00-00Z',
      'vtt-backup-2026-10-27T21-00-00Z',
      'vtt-backup-2026-10-28T03-00-00Z',
    ]);
    expect(log.error).not.toHaveBeenCalled();
    stop();
    vi.advanceTimersByTime(24 * HOUR);
    expect(folders(backups)).toHaveLength(4);
    db.$client.close();
  });

  it('carries the schedule across a restart', () => {
    const { data, backups, db } = instance();
    const options = {
      dataDir: data,
      backup: { dir: backups, intervalMs: 24 * HOUR, keep: 7 },
      now: () => new Date(),
      log,
    };
    startBackups(options)();
    vi.advanceTimersByTime(20 * HOUR);
    // Restarted 20 hours later: the last backup is recent, so none now.
    const stop = startBackups(options);
    expect(folders(backups)).toHaveLength(1);
    vi.advanceTimersByTime(4 * HOUR);
    expect(folders(backups)).toEqual([
      'vtt-backup-2026-10-27T03-00-00Z',
      'vtt-backup-2026-10-28T03-00-00Z',
    ]);
    stop();
    db.$client.close();
  });

  it('logs a failed backup and keeps going', () => {
    const missing = path.join(mkdtempSync(path.join(tmpdir(), 'vtt-backups-')), 'none');
    const stop = startBackups({
      dataDir: missing,
      backup: { dir: path.join(missing, 'out'), intervalMs: HOUR, keep: 1 },
      now: () => new Date(),
      log,
    });
    vi.advanceTimersByTime(HOUR);
    // Tried at start, then again at every check, since no backup exists yet.
    expect(log.error).toHaveBeenCalledTimes(1 + HOUR / BACKUP_CHECK_MS);
    stop();
  });

  it('reads the settings from the environment', () => {
    expect(loadConfig({}).backup).toBeUndefined();
    expect(loadConfig({ BACKUP_DIR: '/srv/backups' }).backup).toEqual({
      dir: path.resolve('/srv/backups'),
      intervalMs: 24 * HOUR,
      keep: 7,
    });
    expect(
      loadConfig({ BACKUP_DIR: 'b', BACKUP_INTERVAL_HOURS: '6', BACKUP_KEEP: '30' }).backup,
    ).toMatchObject({ intervalMs: 6 * HOUR, keep: 30 });
    expect(() => loadConfig({ BACKUP_DIR: 'b', BACKUP_KEEP: '0' })).toThrow('BACKUP_KEEP');
  });
});
