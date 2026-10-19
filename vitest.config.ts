import { defineConfig } from 'vitest/config';

// Runs every package's own vitest.config.ts as a project (IDE integration, `pnpm test:all`).
// CI runs tests per package through Turborepo, where coverage gates apply.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
});
