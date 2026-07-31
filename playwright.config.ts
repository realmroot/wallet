import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:6230'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? 'pnpm dev',
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env.PLAYWRIGHT_WEB_SERVER_COMMAND,
    timeout: 120_000,
  },
})
