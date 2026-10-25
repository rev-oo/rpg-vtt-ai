import { fileURLToPath } from 'node:url';

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

/** The browsers the suite runs on (T-0702); `E2E_BROWSERS=chromium` runs a subset. */
const ALL_BROWSERS = [
  { name: 'chromium', device: devices['Desktop Chrome'] },
  { name: 'firefox', device: devices['Desktop Firefox'] },
  { name: 'webkit', device: devices['Desktop Safari'] },
];
const chosen = process.env.E2E_BROWSERS?.split(',').map((name) => name.trim());
const browsers = ALL_BROWSERS.filter(({ name }) => !chosen || chosen.includes(name)).map(
  (browser, index) => ({
    ...browser,
    apiPort: 3100 + index,
    webPort: 4173 + index,
    dataDir: fileURLToPath(new URL(`.data/${browser.name}`, import.meta.url)),
  }),
);
if (browsers.length === 0) throw new Error(`No browser matches E2E_BROWSERS=${String(chosen)}`);

// Runs against the built apps (`turbo run e2e` builds them first). Each browser gets its own
// instance, an API server on a fresh data directory and the SPA served by `vite preview`
// proxying to it, because the tests create users and tables with fixed names. In each
// instance the first-run test creates the admin every other test signs in as, so it runs first.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
  projects: browsers.flatMap(({ name, device, webPort, dataDir }) => {
    const use = { ...device, baseURL: `http://127.0.0.1:${String(webPort)}` };
    return [
      { name: `first-run-${name}`, testMatch: 'smoke.spec.ts', use, metadata: { dataDir } },
      {
        name,
        testIgnore: 'smoke.spec.ts',
        dependencies: [`first-run-${name}`],
        use,
        metadata: { dataDir },
      },
    ];
  }),
  webServer: browsers.flatMap(
    ({ apiPort, webPort, dataDir }): NonNullable<PlaywrightTestConfig['webServer']> => [
      {
        command: 'node scripts/start-server.mjs',
        url: `http://127.0.0.1:${String(apiPort)}/api/v1/setup/status`,
        env: { E2E_API_PORT: String(apiPort), E2E_DATA_DIR: dataDir, LOG_LEVEL: 'warn' },
        reuseExistingServer: false,
        timeout: 60_000,
      },
      {
        command: `pnpm --filter @vtt/web exec vite preview --host 127.0.0.1 --port ${String(webPort)} --strictPort`,
        url: `http://127.0.0.1:${String(webPort)}`,
        env: { VTT_API_URL: `http://127.0.0.1:${String(apiPort)}` },
        reuseExistingServer: false,
        timeout: 60_000,
      },
    ],
  ),
});
