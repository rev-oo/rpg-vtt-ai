import type { InstanceInfo } from '@vtt/shared/api';

import { api } from '../api/endpoints.js';
import { t } from '../i18n/index.js';

let cached: Promise<InstanceInfo> | null = null;

/** The site name and registration policy, fetched once (FR-ADMIN-01). */
export function loadInstanceInfo(): Promise<InstanceInfo> {
  cached ??= api.instanceInfo().catch((): InstanceInfo => {
    cached = null;
    return { siteName: t('app.name'), registration: 'closed' };
  });
  return cached;
}

/** After an admin changed the settings; the next loader run fetches them again. */
export function refreshInstanceInfo(): void {
  cached = null;
}
