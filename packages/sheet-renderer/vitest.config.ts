import { mergeConfig } from 'vitest/config';

import { defineVttVitestConfig } from '@vtt/config/vitest';

// The preview test reads plugin stylesheets as text, which Vitest leaves empty unless told.
// Sheet tests type into whole sheets; `pnpm test` runs every package at once, so they get
// more time than a unit test would.
export default mergeConfig(
  defineVttVitestConfig({
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000,
  }),
  { test: { css: { include: [/plugins\/.+\.css/] } } },
);
