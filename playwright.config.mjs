import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.test.mjs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // Static preview of the bundled app
      command: 'bun scripts/e2e-preview.mjs',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Real API server (Tachyon routes, console SMS/SMTP adapters, temp Fylo root)
      command: 'bun scripts/e2e-api.mjs',
      url: 'http://localhost:9876',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
