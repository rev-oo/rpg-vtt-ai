import type { ComponentType } from 'react';
import { z } from 'zod';

import type { FormulaFunction } from '@vtt/formula';
import { pluginDefinitionSchema, type PluginDefinition } from '@vtt/plugin-schema';
import type { CardProps, ClientDefinition, NodeProps } from '@vtt/sdk/client';

import { api } from '../api/endpoints.js';

/** A system plugin ready for the page: its definition, and its client code if any. */
export interface LoadedSystem {
  id: string;
  name: string;
  version: string;
  definition: PluginDefinition;
  client: ClientDefinition | null;
  /** Why the client code did not load; the sheet then shows notices for custom nodes. */
  clientError: string | null;
  /** The functions of `code/shared.js`, which formulas call (ADR-047). */
  functions: Readonly<Record<string, FormulaFunction>>;
  /** Why the shared code did not load; formulas calling it then fail. */
  sharedError: string | null;
}

const component = z.custom<ComponentType>(
  (value) => typeof value === 'function' || (typeof value === 'object' && value !== null),
);
/** The default export of `code/client.js`, checked like any external input (specs §6.1). */
const clientModule = z.object({
  default: z.object({
    nodes: z.record(z.string(), component).optional(),
    cards: z.record(z.string(), component).optional(),
  }),
});

/** The default export of `code/shared.js`: `defineShared({ functions })`. */
const sharedModule = z.object({
  default: z.object({
    functions: z
      .record(
        z.string(),
        z.custom<FormulaFunction>((value) => typeof value === 'function'),
      )
      .optional(),
  }),
});

/** The functions of a loaded `code/shared.js` module, checked like any external input. */
export function sharedFunctions(loaded: unknown): Readonly<Record<string, FormulaFunction>> {
  const parsed = sharedModule.safeParse(loaded);
  if (!parsed.success) {
    throw new Error('code/shared.js must export defineShared({ functions }) by default');
  }
  return parsed.data.default.functions ?? {};
}

/** Adds a plugin's scoped stylesheets to the page, once each (ADR-021). */
function addStyles(urls: readonly string[]): void {
  const present = new Set(
    [...document.head.querySelectorAll<HTMLLinkElement>('link[data-plugin-style]')].map(
      (link) => link.dataset.pluginStyle,
    ),
  );
  for (const url of urls) {
    if (present.has(url)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.dataset.pluginStyle = url;
    document.head.append(link);
  }
}

/** Loads `code/client.js`; plugin code is trusted once an admin enabled it (FR-PLUGIN-06). */
async function loadClient(url: string): Promise<ClientDefinition> {
  const loaded: unknown = await import(/* @vite-ignore */ url);
  const parsed = clientModule.safeParse(loaded);
  if (!parsed.success) throw new Error('code/client.js must export defineClient({ … }) by default');
  return parsed.data.default as {
    nodes?: Record<string, ComponentType<NodeProps>>;
    cards?: Record<string, ComponentType<CardProps>>;
  };
}

async function load(id: string): Promise<LoadedSystem> {
  const system = await api.getSystem(id);
  const definition = pluginDefinitionSchema.parse(system.definition);
  addStyles(system.styles);
  let client: ClientDefinition | null = null;
  let clientError: string | null = null;
  if (system.client) {
    try {
      // The version keeps the browser from reusing the module of an older install.
      client = await loadClient(`${system.client}?v=${encodeURIComponent(system.version)}`);
    } catch (error) {
      clientError = error instanceof Error ? error.message : String(error);
    }
  }
  let functions: Readonly<Record<string, FormulaFunction>> = {};
  let sharedError: string | null = null;
  if (system.shared) {
    try {
      const url = `${system.shared}?v=${encodeURIComponent(system.version)}`;
      functions = sharedFunctions(await import(/* @vite-ignore */ url));
    } catch (error) {
      sharedError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    id,
    name: system.name,
    version: system.version,
    definition,
    client,
    clientError,
    functions,
    sharedError,
  };
}

const cache = new Map<string, Promise<LoadedSystem>>();

/** Loads a system once per id and version; a failed load is retried next time. */
export function loadSystem(id: string, version: string): Promise<LoadedSystem> {
  const key = `${id}@${version}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = load(id);
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

/** Forgets loaded systems; for tests. */
export function clearLoadedSystems(): void {
  cache.clear();
}

/**
 * The plugin's texts in `locale`, then its default language, then the text as written: a
 * lang key the plugin lacks, or literal text (specs §8.3).
 */
export function systemTranslator(
  definition: PluginDefinition,
  locale: string,
): (text: string) => string {
  const fallback = definition.manifest.defaultLocale ?? definition.manifest.locales?.[0] ?? 'en';
  const langs = [definition.lang[locale], definition.lang[fallback]].filter(
    (lang): lang is Record<string, string> => lang !== undefined,
  );
  return (text) => {
    for (const lang of langs) if (Object.hasOwn(lang, text)) return lang[text] ?? text;
    return text;
  };
}
