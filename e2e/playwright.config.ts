import { defineConfig, devices } from '@playwright/test';

const API_PORT = 3100;
const WEB_PORT = 4173;

// Runs against the built apps (`turbo run e2e` builds them first): the API server on a fresh
// data directory, and the SPA served by `vite preview`, which proxies /api to it.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(WEB_PORT)}`,
    trace: 'retain-on-failure',
  },
  // Chromium for now; Firefox and WebKit join with the full suite (T-0702). The first-run
  // test creates the admin every other test signs in as, so it runs first.
  projects: [
    { name: 'first-run', testMatch: 'smoke.spec.ts', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testIgnore: 'smoke.spec.ts',
      dependencies: ['first-run'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node scripts/start-server.mjs',
      url: `http://127.0.0.1:${String(API_PORT)}/api/v1/setup/status`,
      env: { E2E_API_PORT: String(API_PORT), LOG_LEVEL: 'warn' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @vtt/web exec vite preview --host 127.0.0.1 --port ${String(WEB_PORT)} --strictPort`,
      url: `http://127.0.0.1:${String(WEB_PORT)}`,
      env: { VTT_API_URL: `http://127.0.0.1:${String(API_PORT)}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
