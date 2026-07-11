import { defineConfig, devices } from "@playwright/test"

// E2E-røyktester. Kjøres mot prod som standard (kun lesende flyter — se
// tests/e2e/smoke.spec.ts). Overstyr mål med E2E_BASE_URL.
// app.proanbud.no ble flyttet til dette prosjektet 2026-07-11 (cutover fra
// gamle v1); nye.proanbud.no serverer fortsatt det samme.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 1,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://app.proanbud.no",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
