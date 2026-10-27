declare module 'virtual:vtt-plugin' {
  import type { PluginDefinition, PluginIssue } from '@vtt/plugin-schema';

  /** The plugin being previewed, from `vtt-plugin dev` (src/commands/dev.ts). */
  const plugin: {
    id: string;
    /** Null while the plugin has errors. */
    definition: PluginDefinition | null;
    issues: PluginIssue[];
    /** Its stylesheets, scoped (ADR-021). */
    css: string;
    /** The URL of `code/client.*`, if any. */
    client: string | null;
    /** The URL of `code/shared.*`, if any. */
    shared: string | null;
  };
  export default plugin;
}
