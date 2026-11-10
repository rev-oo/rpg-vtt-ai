// @ts-check
// Single source of truth for workspace layering (specs §4.4 and §6.2).
import { builtinModules } from 'node:module';

/** @typedef {'pure' | 'node' | 'react' | 'web' | 'tooling'} PackageKind */

/**
 * Every app and package, keyed by its path relative to the repo root.
 * `kind` selects the ESLint preset.
 * @type {Record<string, { type: string, kind: PackageKind }>}
 */
export const workspacePackages = {
  'packages/shared': { type: 'shared', kind: 'pure' },
  'packages/formula': { type: 'formula', kind: 'pure' },
  'packages/plugin-schema': { type: 'plugin-schema', kind: 'pure' },
  'packages/plugin-engine': { type: 'plugin-engine', kind: 'pure' },
  'packages/ui': { type: 'ui', kind: 'react' },
  'packages/sheet-renderer': { type: 'sheet-renderer', kind: 'react' },
  'packages/sdk': { type: 'sdk', kind: 'pure' },
  'packages/config': { type: 'config', kind: 'tooling' },
  'packages/plugin-io': { type: 'plugin-io', kind: 'node' },
  'packages/plugin-cli': { type: 'plugin-cli', kind: 'node' },
  'apps/server': { type: 'server', kind: 'node' },
  'apps/web': { type: 'web', kind: 'web' },
  // Playwright suites drive the built apps over HTTP; they import no workspace code.
  e2e: { type: 'e2e', kind: 'node' },
  // A plugin's code with npm dependencies to bundle (T-1604); it runs in a plugin frame.
  'plugins/dice-3d/code': { type: 'plugin-code', kind: 'react' },
  // A plugin's shared and server code (T-1605); it runs in QuickJS, with no Node or DOM.
  'plugins/srd5/code': { type: 'plugin-server-code', kind: 'pure' },
};

const PURE_CHAIN = ['shared', 'formula', 'plugin-schema', 'plugin-engine'];
const ALL_PACKAGES = [
  ...PURE_CHAIN,
  'ui',
  'sheet-renderer',
  'sdk',
  'sdk-client',
  'plugin-io',
  'plugin-cli',
];

/**
 * Element descriptors for eslint-plugin-boundaries: each element is a folder.
 * First match wins, so the `sdk-client` sub-element is listed before `sdk`.
 */
export const boundaryElements = [
  { type: 'sdk-client', pattern: 'packages/sdk/src/client' },
  { type: 'sdk-client', pattern: 'packages/sdk/test/client' },
  ...Object.entries(workspacePackages).map(([dir, { type }]) => ({ type, pattern: dir })),
];

/**
 * Which elements each element may import. Anything not listed is disallowed,
 * including every `packages/*` → `apps/*` import.
 * @type {Record<string, string[]>}
 */
const allowedImports = {
  shared: [],
  formula: ['shared'],
  'plugin-schema': ['shared', 'formula'],
  'plugin-engine': ['shared', 'formula', 'plugin-schema'],
  ui: [],
  'sheet-renderer': [...PURE_CHAIN, 'ui'],
  sdk: [...PURE_CHAIN],
  'sdk-client': [...PURE_CHAIN, 'sdk', 'sdk-client'],
  // Plugin folders and archives on disk: Node only, shared by the server and the CLI.
  'plugin-io': ['shared', 'formula', 'plugin-schema'],
  'plugin-cli': ALL_PACKAGES.filter((t) => t !== 'plugin-cli'),
  config: [],
  // §6.2: the server may not import React packages.
  server: ALL_PACKAGES.filter(
    (t) => !['ui', 'sheet-renderer', 'sdk-client', 'plugin-cli'].includes(t),
  ),
  web: ALL_PACKAGES,
  e2e: [],
  // Plugin client code gets only the SDK's client hooks from the app (ADR-074). They resolve
  // to the SDK's build, an `sdk` element; restrictedModules keeps it to `@vtt/sdk/client`.
  'plugin-code': ['sdk-client', 'sdk'],
  // Plugin shared and server code imports `@vtt/sdk` (defineShared, defineServer), which
  // `vtt-plugin pack` bundles in.
  'plugin-server-code': ['sdk'],
};

export const boundaryPolicies = [
  ...Object.entries(allowedImports)
    .filter(([, to]) => to.length > 0)
    .map(([from, to]) => ({
      from: { element: { type: from } },
      allow: { to: { element: { types: { anyOf: to } } } },
    })),
  // Tooling presets (ESLint, Vitest) are imported by every package's config files.
  { allow: { to: { element: { type: 'config' } } } },
];

const NODE_BUILTINS = builtinModules.filter((m) => !m.startsWith('_'));

/**
 * @typedef {{ paths: string[], patterns: string[], message: string }} Restriction
 */

/**
 * Module-name bans enforced with `no-restricted-imports`, keyed by element type. `tests`, if
 * given, replaces the bans in test files: plugin tests may import the SDK's testing kits, which
 * a plugin's packed code could not load (T-1613).
 * @type {Record<string, Restriction & { tests?: Omit<Restriction, 'message'> }>}
 */
export const restrictedModules = {
  ...Object.fromEntries(
    ['shared', 'formula', 'plugin-engine'].map((type) => [
      type,
      {
        paths: ['react', 'react-dom', 'fastify', 'drizzle-orm', ...NODE_BUILTINS],
        patterns: ['react/*', 'react-dom/*', 'fastify/*', 'drizzle-orm/*', 'node:*'],
        message:
          'Pure packages must not depend on React, Fastify, Drizzle or Node built-ins (specs §4.4).',
      },
    ]),
  ),
  'plugin-code': {
    paths: ['@vtt/sdk'],
    patterns: ['@vtt/sdk/*', '!@vtt/sdk/client', '@vtt/sdk/client/*'],
    message:
      'Plugin client code may import only @vtt/sdk/client, which the plugin frame provides (ADR-074).',
    tests: {
      paths: ['@vtt/sdk'],
      patterns: ['@vtt/sdk/*', '!@vtt/sdk/client', '@vtt/sdk/client/*', '!@vtt/sdk/client/testing'],
    },
  },
  'plugin-server-code': {
    paths: ['react', 'react-dom', '@vtt/sdk/client', '@vtt/sdk/testing', ...NODE_BUILTINS],
    patterns: ['react/*', 'react-dom/*', '@vtt/sdk/client/*', 'node:*'],
    message:
      'Plugin shared and server code runs in QuickJS: no React, client SDK, SDK testing kit or Node built-ins (ADR-073).',
    tests: {
      paths: ['react', 'react-dom', '@vtt/sdk/client', ...NODE_BUILTINS],
      patterns: ['react/*', 'react-dom/*', '@vtt/sdk/client/*', 'node:*'],
    },
  },
  server: {
    paths: ['@vtt/ui', '@vtt/sheet-renderer', '@vtt/sdk/client'],
    patterns: ['@vtt/ui/*', '@vtt/sheet-renderer/*', '@vtt/sdk/client/*'],
    message: 'The server must not import React packages (specs §4.4 rule 2).',
  },
};
