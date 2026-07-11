import { defineConfig, devices } from "@playwright/test"

// E2E-røyktester. Kjøres mot prod som standard (kun lesende flyter — se
// tests/e2e/smoke.spec.ts). Overstyr mål med E2E_BASE_URL.
// NB: v2 (dette repoet) er deployet på nye.proanbud.no — app.proanbud.no er
// fortsatt gamle v1 inntil DNS-cutover. Oppdater her ved cutover.
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: 1,
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://nye.proanbud.no",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
