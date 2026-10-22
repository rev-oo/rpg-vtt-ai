// The modules plugin client code imports by name (specs §8.10, ADR-025). The app puts its own
// copies on a global, and an import map points each name at a small shim that re-exports them,
// so plugins share the app's React instead of bundling their own. `vite.config.ts` builds the
// shims from this list.

/** The global the app keeps the shared modules on. */
export const RUNTIME_GLOBAL = '__VTT_PLUGIN_RUNTIME__';

/** Each shared module and the URL of its shim. */
export const SHARED_MODULES = {
  react: '/plugin-runtime/react.js',
  'react/jsx-runtime': '/plugin-runtime/react-jsx-runtime.js',
  '@vtt/sdk/client': '/plugin-runtime/vtt-sdk-client.js',
} as const;

export type SharedModule = keyof typeof SHARED_MODULES;

/** The import map the page declares before any module loads. */
export const IMPORT_MAP = JSON.stringify({ imports: SHARED_MODULES });
