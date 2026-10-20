import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './browser-tests',
  testMatch: '**/*.browser.ts',
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: false,
  },
  use: {
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    headless: true,
    trace: 'retain-on-failure',
  },
})
