// @ts-check
// Shared Vitest preset (specs §13). Each package's `vitest.config.ts` calls `defineVttVitestConfig`.
import { defineConfig } from 'vitest/config';

/**
 * @typedef {object} CoverageGate
 * @property {number} percent minimum lines/functions/branches/statements coverage
 * @property {string} [files] glob (relative to the package) the gate applies to; defaults to all sources
 */

/**
 * @param {{ coverageGate?: CoverageGate }} [options]
 */
export function defineVttVitestConfig(options = {}) {
  const gate = options.coverageGate;
  const minimums = gate && {
    lines: gate.percent,
    functions: gate.percent,
    branches: gate.percent,
    statements: gate.percent,
  };
  const thresholds = minimums && (gate.files ? { [gate.files]: minimums } : minimums);

  return defineConfig({
    test: {
      include: ['test/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['**/__lint-fixtures__/**'],
        reporter: ['text', 'html', 'json-summary'],
        ...(thresholds && { thresholds }),
      },
    },
  });
}
