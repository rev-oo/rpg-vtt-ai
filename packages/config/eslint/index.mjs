// @ts-check
// Shared ESLint flat-config preset (specs §6.1, §6.2). The root `eslint.config.mjs` calls
// `defineVttConfig()`; per-package rules are scoped by directory from ./workspace.mjs.
// A single root config keeps one TypeScript project service for the whole monorepo, which
// matters for memory when linting many packages in one run (lint-staged, the editor).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import boundaries from 'eslint-plugin-boundaries';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import {
  boundaryElements,
  boundaryPolicies,
  restrictedModules,
  workspacePackages,
} from './workspace.mjs';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const require = createRequire(import.meta.url);
// The plugin is CJS with ESM-style typings, so its default import is mistyped under NodeNext.
const boundariesPlugin = /** @type {import('eslint').ESLint.Plugin} */ (
  /** @type {unknown} */ (boundaries)
);
const TS_EXT = '{ts,tsx,mts,cts}';
const JS_EXT = '{js,mjs,cjs}';
const CODE_FILES = [`**/*.${TS_EXT}`, `**/*.${JS_EXT}`];
const CONFIG_FILES = ['**/*.config.ts', `**/*.${JS_EXT}`];
const TEST_FILES = ['**/test/**', '**/*.test.{ts,tsx}'];
const LINT_FIXTURES = ['**/__lint-fixtures__/**'];

/** @param {string} dir */
const filesIn = (dir) => [`${dir}/**/*.${TS_EXT}`, `${dir}/**/*.${JS_EXT}`];

/**
 * Rules that depend on which package a file belongs to.
 * @param {string} dir package path relative to the repo root
 * @param {{ type: string, kind: string }} pkg
 * @returns {import('eslint').Linter.Config[]}
 */
function packageConfigs(dir, { type, kind }) {
  const files = filesIn(dir);
  const restricted = restrictedModules[type];
  const isReact = kind === 'react' || kind === 'web';

  /** @type {import('eslint').Linter.Config[]} */
  const configs = [
    {
      files,
      languageOptions: {
        globals: isReact ? globals.browser : kind === 'pure' ? {} : globals.node,
      },
    },
  ];
  if (restricted) {
    configs.push({
      files,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: restricted.paths.map((name) => ({ name, message: restricted.message })),
            patterns: [{ group: restricted.patterns, message: restricted.message }],
          },
        ],
      },
    });
  }
  if (isReact) {
    configs.push({ ...reactHooks.configs.flat.recommended, files });
  }
  if (kind === 'web') {
    configs.push({ ...reactRefresh.configs.vite, files });
  }
  if (kind === 'web') {
    // React Router route modules export these alongside the component (framework mode).
    configs.push({
      files: [`${dir}/src/root.tsx`, `${dir}/src/routes/**`],
      rules: {
        'react-refresh/only-export-components': [
          'error',
          {
            allowExportNames: [
              'clientLoader',
              'clientAction',
              'shouldRevalidate',
              'meta',
              'links',
              'handle',
              'Layout',
              'HydrateFallback',
              'ErrorBoundary',
            ],
          },
        ],
      },
    });
  }
  if (type === 'server') {
    // §6.2: the server logs through its logger module only.
    configs.push(
      { files, rules: { 'no-console': 'error' } },
      { files: [`${dir}/src/logger/**`], rules: { 'no-console': 'off' } },
    );
  }
  return configs;
}

/** Builds the flat config for the whole monorepo. */
export function defineVttConfig() {
  return defineConfig(
    globalIgnores([
      '**/dist/',
      '**/coverage/',
      '**/.turbo/',
      '**/build/',
      '**/.react-router/',
      'packages/plugin-schema/schemas/',
      ...LINT_FIXTURES,
    ]),

    {
      files: CODE_FILES,
      extends: [
        js.configs.recommended,
        tseslint.configs.strictTypeChecked,
        tseslint.configs.stylisticTypeChecked,
        importX.flatConfigs.recommended,
        importX.flatConfigs.typescript,
      ],
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        parserOptions: {
          projectService: true,
          tsconfigRootDir: repoRoot,
        },
      },
      settings: {
        'import-x/internal-regex': '^@vtt/',
        'import-x/resolver-next': [
          createTypeScriptImportResolver({ alwaysTryTypes: true }),
          createNodeResolver(),
        ],
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 5 },
        ],
        '@typescript-eslint/explicit-module-boundary-types': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        'import-x/no-cycle': ['error', { ignoreExternal: true }],
        // Noisy with TypeScript-typed default exports (typescript-eslint, react-refresh).
        'import-x/no-named-as-default': 'off',
        'import-x/no-named-as-default-member': 'off',
        'import-x/order': [
          'error',
          {
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
            'newlines-between': 'always',
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
      },
    },

    // Config files and plain JS sit outside any tsconfig, so they are linted without type
    // information. JSDoc types are checked by `tsc` where a package enables `checkJs`.
    {
      files: CONFIG_FILES,
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
      rules: { '@typescript-eslint/explicit-module-boundary-types': 'off' },
    },

    // Layer boundaries between workspace packages (specs §4.4, §6.2).
    {
      files: CODE_FILES,
      plugins: { boundaries: boundariesPlugin },
      settings: {
        'boundaries/root-path': repoRoot,
        'boundaries/elements': boundaryElements,
        'import/resolver': {
          [require.resolve('eslint-import-resolver-typescript')]: { alwaysTryTypes: true },
        },
      },
      rules: {
        'boundaries/dependencies': ['error', { default: 'disallow', policies: boundaryPolicies }],
      },
    },

    ...Object.entries(workspacePackages).flatMap(([dir, pkg]) => packageConfigs(dir, pkg)),

    // §6.1: non-null assertions are allowed in tests.
    { files: TEST_FILES, rules: { '@typescript-eslint/no-non-null-assertion': 'off' } },

    // Deliberate violations, only linted by @vtt/config's fixture test (without type info).
    {
      files: LINT_FIXTURES,
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { parserOptions: { projectService: false, project: false } },
    },

    prettier,
  );
}
