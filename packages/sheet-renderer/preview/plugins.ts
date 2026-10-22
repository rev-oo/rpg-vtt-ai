import { scopeCss, validatePlugin, type PluginValidation } from '@vtt/plugin-schema';

// Every file of the repository's reference plugins, as text (`plugins/<id>/…`).
const sources = import.meta.glob<string>('../../../plugins/*/**/*.{json,css}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Code files only need to be listed: the validator checks `hasCode` against them.
const code = import.meta.glob('../../../plugins/*/code/**');

const PREFIX = '../../../plugins/';

/** The ids of the plugins in `plugins/`. */
export const PREVIEW_PLUGINS: string[] = [
  ...new Set(Object.keys(sources).map((path) => path.slice(PREFIX.length).split('/')[0] ?? '')),
].sort();

export interface PreviewPlugin extends PluginValidation {
  /** The plugin's stylesheets, scoped (ADR-021). */
  css: string;
}

/** Validates one plugin folder the way the server does, and scopes its CSS. */
export function loadPreviewPlugin(id: string): PreviewPlugin {
  const files = new Map<string, string>();
  const entries = [
    ...Object.entries(sources),
    ...Object.keys(code).map((path): [string, string] => [path, '']),
  ];
  for (const [path, text] of entries) {
    const relative = path.slice(PREFIX.length);
    if (relative.startsWith(`${id}/`)) files.set(relative.slice(id.length + 1), text);
  }
  const validation = validatePlugin(files, { folder: id });
  const css = (validation.plugin?.styles ?? [])
    .map((file) => scopeCss(files.get(file) ?? '', { pluginId: id, file }).css)
    .join('\n');
  return { ...validation, css };
}
