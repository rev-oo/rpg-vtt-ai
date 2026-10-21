import { z } from 'zod';

// The plugin admin API (§10.1, FR-ADMIN-02). Issue codes and their parameters come from the
// plugin validator (ADR-019); each app words them.

/**
 * `ready`: valid and compatible. `invalid`: the validator found errors. `incompatible`: its
 * `coreApi` excludes this core (FR-PLUGIN-03). `missing`: its folder is gone.
 */
export const PLUGIN_STATUSES = ['ready', 'invalid', 'incompatible', 'missing'] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

export const pluginIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  file: z.string(),
  path: z.array(z.union([z.string(), z.number()])),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type PluginIssueView = z.infer<typeof pluginIssueSchema>;

export const adminPluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().nullable(),
  /** The `coreApi` range the plugin declares. */
  coreApi: z.string(),
  hasCode: z.boolean(),
  /** Files under `code/`, listed for the admin to review (§8.10). */
  codeEntries: z.array(z.string()),
  enabled: z.boolean(),
  status: z.enum(PLUGIN_STATUSES),
  /** Enabled and ready: tables can use it. Tables of an unavailable system are read-only. */
  available: z.boolean(),
  issues: z.array(pluginIssueSchema),
  scannedAt: z.string().nullable(),
});
export type AdminPlugin = z.infer<typeof adminPluginSchema>;

export const pluginsResponseSchema = z.object({ plugins: z.array(adminPluginSchema) });
export const pluginResponseSchema = z.object({ plugin: adminPluginSchema });

/** Enabling a plugin with code must acknowledge it runs in-process (FR-PLUGIN-06, 08). */
export const enablePluginBody = z.object({ acknowledgeCode: z.boolean().optional() });
export type EnablePluginInput = z.infer<typeof enablePluginBody>;
