import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE = `http://localhost:${PORT}/Sunset-tracker/`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: 'fixtures', testMatch: /.*\.fixtures\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    { name: 'live', testMatch: /.*\.live\.spec\.ts/, use: { ...devices['Pixel 7'] }, timeout: 120_000 },
  ],
  webServer: {
    command: 'npm run preview',
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
