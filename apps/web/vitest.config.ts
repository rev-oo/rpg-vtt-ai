import { defineVttVitestConfig } from '@vtt/config/vitest';

// App tests render whole routes, whose modules load lazily on first use. `pnpm test` runs every
// package at once, so they get more time than a unit test would.
export default defineVttVitestConfig({
  environment: 'jsdom',
  setupFiles: ['./test/setup.ts'],
  testTimeout: 15_000,
});
