import { z } from 'zod';

import { dataIssueSchema } from './collab.js';

// What a table upgrade did to its actors' and items' data (FR-PLUGIN-12, ADR-072).

/** The most failures one report lists; `failedCount` counts them all. */
export const MAX_REPORTED_FAILURES = 100;
/** The most value issues one failure lists. */
export const MAX_FAILURE_ISSUES = 20;

/**
 * Why an entity was left as it was: a `migrations/` step could not run (`step`), the
 * `migrate` hook failed or answered with something other than data (`hook`), the plugin's
 * code could not load (`code`), or the result does not fit the type's schema (`invalid`).
 */
export const MIGRATION_FAILURES = ['step', 'hook', 'code', 'invalid'] as const;

export const migrationFailureSchema = z.object({
  kind: z.enum(['actor', 'item']),
  id: z.string(),
  name: z.string(),
  reason: z.enum(MIGRATION_FAILURES),
  /** For `step`: the migration file's version and the step's index in it. */
  version: z.string().optional(),
  step: z.number().int().min(0).optional(),
  /** For `invalid`: the values that do not fit, by path. */
  issues: z.array(dataIssueSchema).max(MAX_FAILURE_ISSUES).optional(),
});
export type MigrationFailure = z.infer<typeof migrationFailureSchema>;

export const migrationReportSchema = z.object({
  /** Entities brought up to the table's version. */
  migrated: z.number().int().min(0),
  failedCount: z.number().int().min(0),
  failed: z.array(migrationFailureSchema).max(MAX_REPORTED_FAILURES),
});
export type MigrationReport = z.infer<typeof migrationReportSchema>;
