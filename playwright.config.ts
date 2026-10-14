import { defineConfig } from '@playwright/test';

const configuredPath = process.env.TEST_BASE_PATH?.replace(/^\/+|\/+$/g, '');
const basePath = configuredPath ? `/${configuredPath}/` : '/';
const baseURL = `http://127.0.0.1:4173${basePath}`;

export default defineConfig({
  testDir: './tests',
  testMatch: 'workflow.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  outputDir: '/private/tmp/smolov-sbd-playwright-results',
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    serviceWorkers: 'allow',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run preview -- --port 4173 --strictPort --base '${basePath.replace(/'/g, "'\\''")}'`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
