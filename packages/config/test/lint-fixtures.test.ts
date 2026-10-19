import { globSync } from 'node:fs';
import path from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../eslint/index.mjs';

// Each fixture is a deliberate violation (specs T-0004, T-0005). It is ignored by the normal
// lint run and linted here with ignores disabled; the listed rule must report an error.
const expectedViolations: Record<string, string> = {
  'packages/shared/src/__lint-fixtures__/no-explicit-any.ts': '@typescript-eslint/no-explicit-any',
  'packages/shared/src/__lint-fixtures__/no-non-null-assertion.ts':
    '@typescript-eslint/no-non-null-assertion',
  'packages/shared/src/__lint-fixtures__/pure-imports-node-builtin.ts': 'no-restricted-imports',
  'packages/shared/src/__lint-fixtures__/package-imports-app.ts': 'boundaries/dependencies',
  'packages/formula/src/__lint-fixtures__/pure-imports-react.ts': 'no-restricted-imports',
  'packages/formula/src/__lint-fixtures__/imports-downstream-layer.ts': 'boundaries/dependencies',
  'packages/plugin-engine/src/__lint-fixtures__/pure-imports-fastify.ts': 'no-restricted-imports',
  'apps/server/src/__lint-fixtures__/server-imports-ui.ts': 'boundaries/dependencies',
  'apps/server/src/__lint-fixtures__/server-imports-sheet-renderer.ts': 'boundaries/dependencies',
  'apps/server/src/__lint-fixtures__/server-imports-sdk-client.ts': 'no-restricted-imports',
  'apps/server/src/__lint-fixtures__/no-console.ts': 'no-console',
};

const ERROR = 2;

describe('lint fixtures', { timeout: 60_000 }, () => {
  const eslint = new ESLint({ cwd: repoRoot, ignore: false });

  it('lists every fixture file', () => {
    const onDisk = globSync('{apps,packages}/*/src/__lint-fixtures__/*', { cwd: repoRoot });
    expect(onDisk.sort()).toEqual(Object.keys(expectedViolations).sort());
  });

  it.each(Object.entries(expectedViolations))('%s fails %s', async (file, ruleId) => {
    const [result] = await eslint.lintFiles([path.join(repoRoot, file)]);
    const errors = result?.messages.filter((m) => m.severity === ERROR).map((m) => m.ruleId);
    expect(errors).toContain(ruleId);
  });
});
