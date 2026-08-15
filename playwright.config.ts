import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --ip 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 15'],
        // WebKit routes service-worker-controlled fetches outside Playwright's
        // request mocking. PWA behavior has its own production Chromium test.
        serviceWorkers: 'block',
      },
    },
  ],
});
