// @ts-check
// Shared ESLint flat-config preset (specs §6.1, §6.2). Each workspace package has a
// two-line `eslint.config.mjs` that calls `defineVttConfig(import.meta.dirname)`.
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
const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];
const CODE_FILES = [...TS_FILES, ...JS_FILES];
const TEST_FILES = ['test/**', '**/*.test.{ts,tsx}'];
const LINT_FIXTURES = ['**/__lint-fixtures__/**'];

/** @type {import('eslint').Linter.Config[]} */
const serverConsoleRules = [
  { files: CODE_FILES, rules: { 'no-console': 'error' } },
  { files: ['src/logger/**'], rules: { 'no-console': 'off' } },
];

/**
 * Builds the flat config for one workspace package (or `repoRoot` for root-level files).
 * @param {string} packageDir absolute path of the directory holding `eslint.config.mjs`
 */
export function defineVttConfig(packageDir) {
  const rel = path.relative(repoRoot, packageDir).split(path.sep).join('/');
  const pkg = rel === '' ? { type: 'root', kind: 'tooling' } : workspacePackages[rel];
  if (!pkg) {
    throw new Error(`Unknown workspace package "${rel}". Register it in @vtt/config/eslint.`);
  }
  const restricted = restrictedModules[pkg.type];
  const isReact = pkg.kind === 'react' || pkg.kind === 'web';

  return defineConfig(
    globalIgnores(['dist/', 'coverage/', '.turbo/', ...LINT_FIXTURES]),

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
        globals: isReact ? globals.browser : pkg.kind === 'pure' ? {} : globals.node,
        parserOptions: {
          projectService: { allowDefaultProject: ['*.config.ts'] },
          tsconfigRootDir: packageDir,
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
        'import-x/no-cycle': 'error',
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

    // Plain JS (config files) is linted without type information; JSDoc types are
    // checked by `tsc` where a package enables `checkJs`.
    {
      files: JS_FILES,
      extends: [tseslint.configs.disableTypeChecked],
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
        ...(restricted && {
          'no-restricted-imports': [
            'error',
            {
              paths: restricted.paths.map((name) => ({ name, message: restricted.message })),
              patterns: [{ group: restricted.patterns, message: restricted.message }],
            },
          ],
        }),
      },
    },

    ...(isReact ? [{ files: CODE_FILES, extends: [reactHooks.configs.flat.recommended] }] : []),
    ...(pkg.kind === 'web' ? [{ files: CODE_FILES, extends: [reactRefresh.configs.vite] }] : []),

    // §6.2: the server logs through its logger module only.
    ...(pkg.type === 'server' ? serverConsoleRules : []),

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
