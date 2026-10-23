import { instanceSettingsSchema, type InstanceSettings } from '@vtt/shared/api';

import type { DbOrTx } from '../db/client.js';
import { instanceSettings } from '../db/schema.js';

/** What an instance starts with; `SESSION_TTL` gives the session lifetime (FR-ADMIN-01). */
export function instanceDefaults(sessionTtlSeconds: number): InstanceSettings {
  return { siteName: 'VTT', registration: 'closed', sessionLifetimeSeconds: sessionTtlSeconds };
}

const KEYS = Object.keys(instanceSettingsSchema.shape) as (keyof InstanceSettings)[];

/** The instance settings: each stored value that is still valid, else its default. */
export function readInstanceSettings(db: DbOrTx, defaults: InstanceSettings): InstanceSettings {
  const stored = new Map(
    db
      .select()
      .from(instanceSettings)
      .all()
      .map((r) => [r.key, r.value]),
  );
  const settings = { ...defaults };
  for (const key of KEYS) {
    const parsed = instanceSettingsSchema.shape[key].safeParse(stored.get(key));
    if (parsed.success) Object.assign(settings, { [key]: parsed.data });
  }
  return settings;
}

/** Stores the given settings, one row per key. */
export function writeInstanceSettings(
  db: DbOrTx,
  patch: { [K in keyof InstanceSettings]?: InstanceSettings[K] | undefined },
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    db.insert(instanceSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value } })
      .run();
  }
}
