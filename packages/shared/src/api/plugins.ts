import { z } from 'zod';

// The plugin admin API (§10.1, FR-ADMIN-02). Issue codes and their parameters come from the
// plugin validator (ADR-019); each app words them.

/**
 * `ready`: valid and compatible. `invalid`: the validator found errors. `incompatible`: its
 * `coreApi` excludes this core (FR-PLUGIN-03). `missing`: its folder is gone.
 */
export const PLUGIN_STATUSES = ['ready', 'invalid', 'incompatible', 'missing'] as const;
export type PluginStatus = (typeof PLUGIN_STATUSES)[number];

/** A game system, or a module that extends any table (FR-PLUGIN-16, ADR-075). */
export const PLUGIN_KINDS = ['system', 'module'] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

/** The credit a plugin's content needs, from its manifest (T-1614). */
export const pluginAttributionSchema = z.object({
  text: z.string(),
  /** An http or https address, checked by the validator. */
  url: z.string().nullable(),
});
export type PluginAttribution = z.infer<typeof pluginAttributionSchema>;

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
  kind: z.enum(PLUGIN_KINDS),
  description: z.string().nullable(),
  /** Null when it has none, or its files no longer load. */
  attribution: pluginAttributionSchema.nullable(),
  /** Whether it declares settings admins set for the whole instance (ADR-075). */
  instanceSettings: z.boolean(),
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

/**
 * `POST /plugins/install` takes a `.vttplugin` archive as an `application/zip` body (ADR-026).
 * `replace=true` lets it replace an installed plugin of the same id.
 */
export const installPluginQuery = z.object({ replace: z.stringbool().default(false) });
export type InstallPluginQuery = z.input<typeof installPluginQuery>;

/** The `details` of an `invalid_plugin` error: the validator's issues. */
export const invalidPluginDetailsSchema = z.object({ issues: z.array(pluginIssueSchema) });

/** Values of a plugin's settings by name; its `settings.json` says what fits (ADR-075). */
export const settingValuesSchema = z.record(z.string().max(64), z.unknown());
export type SettingValuesView = z.infer<typeof settingValuesSchema>;

/**
 * `GET/PATCH /plugins/:id/settings` (admins, instance scope) and `/me/plugins/:id/settings`
 * (each user, user scope): one scope of a plugin's settings, with what the form needs.
 */
export const pluginSettingsResponseSchema = z.object({
  /** The settings of this scope as `settings.json` declares them; `settingSchema` in plugin-schema. */
  definitions: z.record(z.string(), z.unknown()),
  /** The plugin's texts by locale, for the labels, and the locale to fall back to. */
  lang: z.record(z.string(), z.record(z.string(), z.string())),
  defaultLocale: z.string(),
  values: settingValuesSchema,
});
export type PluginSettingsResponse = z.infer<typeof pluginSettingsResponseSchema>;

/** Replaces the stored values of one scope; names and values must fit the declarations. */
export const updatePluginSettingsBody = z.object({ values: settingValuesSchema });
export type UpdatePluginSettingsInput = z.infer<typeof updatePluginSettingsBody>;

/** `GET /modules`: the modules GMs may add to a table (enabled and ready). */
export const moduleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().nullable(),
});
export type ModuleSummary = z.infer<typeof moduleSummarySchema>;
export const modulesResponseSchema = z.object({ modules: z.array(moduleSummarySchema) });

/**
 * `GET /tables/:id/modules`: the table's modules that are available, as its members load them
 * (ADR-075). `definition` is the validator's output (`pluginDefinitionSchema`).
 */
export const tableModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  definition: z.record(z.string(), z.unknown()),
  /** URLs of its scoped stylesheets and of `code/client.js`, served by `/plugins/<id>/*`. */
  styles: z.array(z.string()),
  client: z.string().nullable(),
  /** Every setting's value for this viewer: instance, table or user, by its scope. */
  settings: settingValuesSchema,
});
export type TableModule = z.infer<typeof tableModuleSchema>;
export const tableModulesResponseSchema = z.object({ modules: z.array(tableModuleSchema) });
