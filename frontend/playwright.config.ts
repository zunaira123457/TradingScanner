import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import webpush from 'web-push';

const APP_PORT = 3200;
const MOCK = 'http://127.0.0.1:4010';
const vapid = webpush.generateVAPIDKeys();

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'playwright-report/results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    // Playwright's desktop WebKit build freezes on pushManager.getSubscription();
    // real Safari push is verified manually (see TESTING.md).
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
    { name: 'tablet', use: { ...devices['iPad Mini'] } },
    ...(process.env.E2E_EDGE ? [{ name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }] : []),
  ],
  webServer: [
    {
      command: 'node e2e/mock-market.mjs',
      url: `${MOCK}/__state`,
      reuseExistingServer: false,
    },
    {
      command: 'sh e2e/start-app.sh',
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(APP_PORT),
        HOSTNAME: '127.0.0.1',
        DATA_DIR: path.resolve('.e2e-data'),
        FINNHUB_API_KEY: 'e2e-finnhub-key',
        TWELVE_DATA_API_KEY: 'e2e-twelve-key',
        TWELVE_DATA_RPM: '600',
        FINNHUB_RPM: '600',
        FINNHUB_BASE_URL: `${MOCK}/finnhub`,
        TWELVE_DATA_BASE_URL: `${MOCK}/twelve`,
        AI_SCANNER_BASE_URL: `${MOCK}/scanner`,
        AI_SCANNER_API_KEY: 'e2e-scanner-key',
        OWNER_KEY: 'e2e-owner-key-123',
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: 'mailto:e2e@example.com',
        PUBLIC_BASE_URL: `http://127.0.0.1:${APP_PORT}`,
      },
    },
  ],
});
