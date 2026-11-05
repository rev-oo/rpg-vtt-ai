import type { FormulaFunction } from '@vtt/formula';
import { pluginDefinitionSchema, type PluginDefinition } from '@vtt/plugin-schema';

import { api } from '../api/endpoints.js';
import { LOCALE } from '../i18n/index.js';

import { probeClient, type FrameCode } from './frame-channel.js';
import { sharedEngineFunctions } from './shared-engine.js';

/**
 * A system's client code, run only inside sandboxed frames (ADR-074): what each frame gets,
 * and the nodes and cards it exports.
 */
export interface LoadedClient {
  frame: FrameCode;
  nodes: readonly string[];
  cards: readonly string[];
}

/** A system plugin ready for the page: its definition, and its client code if any. */
export interface LoadedSystem {
  id: string;
  name: string;
  version: string;
  definition: PluginDefinition;
  client: LoadedClient | null;
  /** Why the client code did not load; the sheet then shows notices for custom nodes. */
  clientError: string | null;
  /** The functions of `code/shared.js`, which formulas call (ADR-047, ADR-074). */
  functions: Readonly<Record<string, FormulaFunction>>;
  /** Why the shared code did not load; formulas calling it then fail. */
  sharedError: string | null;
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

/** A plugin file as text, fetched with the session: plugin files are for signed-in users. */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`${url} did not load (${String(response.status)})`);
  return response.text();
}

/** The plugin's texts in `locale`, then in its default language (specs §8.3). */
export function systemLang(
  definition: PluginDefinition,
  locale: string,
): Readonly<Record<string, string>>[] {
  const fallback = definition.manifest.defaultLocale ?? definition.manifest.locales?.[0] ?? 'en';
  return [definition.lang[locale], definition.lang[fallback]].filter(
    (lang): lang is Record<string, string> => lang !== undefined,
  );
}

/** Fetches `code/client.js` and lists what it exports, in a sandboxed frame. */
async function loadClient(
  id: string,
  url: string,
  definition: PluginDefinition,
): Promise<LoadedClient> {
  const frame: FrameCode = {
    pluginId: id,
    code: await fetchText(url),
    lang: systemLang(definition, LOCALE),
  };
  const { nodes, cards } = await probeClient(frame);
  return { frame, nodes, cards };
}

async function load(id: string): Promise<LoadedSystem> {
  const system = await api.getSystem(id);
  const definition = pluginDefinitionSchema.parse(system.definition);
  addStyles(system.styles);
  let client: LoadedClient | null = null;
  let clientError: string | null = null;
  if (system.client) {
    try {
      // The version keeps the browser from reusing the module of an older install.
      const url = `${system.client}?v=${encodeURIComponent(system.version)}`;
      client = await loadClient(id, url, definition);
    } catch (error) {
      clientError = error instanceof Error ? error.message : String(error);
    }
  }
  let functions: Readonly<Record<string, FormulaFunction>> = {};
  let sharedError: string | null = null;
  if (system.shared) {
    try {
      const url = `${system.shared}?v=${encodeURIComponent(system.version)}`;
      functions = await sharedEngineFunctions(await fetchText(url));
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
  const langs = systemLang(definition, locale);
  return (text) => {
    for (const lang of langs) if (Object.hasOwn(lang, text)) return lang[text] ?? text;
    return text;
  };
}
