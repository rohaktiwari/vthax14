import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the frontend end-to-end smoke test.
 *
 * The dev server is started with `VITE_API_BASE_URL=/api` (same origin) so the
 * browser tests can intercept the documented backend routes with Playwright
 * `page.route` and contract-matching fixtures. No backend process is required
 * and no Python/server command is ever run by the frontend.
 *
 * Screenshots and traces are written under `test-results/` (gitignored).
 */
export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: false,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:4173",
    browserName: "chromium",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_API_BASE_URL: "/api" },
  },
});
