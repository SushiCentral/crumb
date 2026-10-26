import { defineConfig, devices } from '@playwright/test';

// Playwright runs this config in Node, but Crumb intentionally does not install
// Node's ambient type definitions for its browser-only application code.
declare const process: { env: Record<string, string | undefined> };

const baseURL = 'http://127.0.0.1:1420';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: `${baseURL}/tests/e2e/vim-fixture.html`,
    reuseExistingServer: !process.env.CI,
  },
});
