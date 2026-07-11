import { test, expect } from "@playwright/test"

// Røyktester mot produksjon. STRENGT LESENDE: ingen signup, ingen betaling,
// ingen datainnskriving. Én bevisst mislykket innlogging med ikke-eksisterende
// e-post er eneste POST (verifiserer at auth-stien svarer og feiler pent).

test("innloggingssiden rendrer med skjema", async ({ page }) => {
  await page.goto("/login")
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

test("rot (dashbord) uten sesjon sendes til innlogging", async ({ page }) => {
  await page.goto("/")
  await page.waitForURL(/\/login/)
  await expect(page.locator('input[type="email"]')).toBeVisible()
})

test("beskyttet rute (/prosjekter) uten sesjon sendes til innlogging", async ({ page }) => {
  await page.goto("/prosjekter")
  await page.waitForURL(/\/login/)
})

test("registreringssiden rendrer med skjema", async ({ page }) => {
  await page.goto("/signup")
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.locator('button[type="submit"]')).toBeVisible()
})

test("ukjent offentlig tilbudslenke lekker ikke innhold", async ({ page }) => {
  await page.goto("/tilbudsvisning/finnes-ikke-e2e-probe")
  // Teksten vises både i selve siden og i en toast — .first() unngår strict-krasj.
  await expect(page.getByText("Tilbudet finnes ikke").first()).toBeVisible({ timeout: 15_000 })
})

test("feil innlogging feiler pent uten krasj", async ({ page }) => {
  await page.goto("/login")
  await page.locator('input[type="email"]').fill("e2e-probe-finnes-ikke@example.com")
  await page.locator('input[type="password"]').fill("feil-passord-123")
  await page.locator('button[type="submit"]').click()
  // Skal IKKE komme inn i appen, og siden skal ikke krasje.
  await page.waitForTimeout(3000)
  expect(page.url()).toContain("/login")
  await expect(page.locator("body")).not.toContainText("Application error")
  await expect(page.locator('input[type="email"]')).toBeVisible()
})
