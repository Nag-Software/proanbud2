#!/usr/bin/env node
/**
 * Creates Proanbud Stripe products and prices.
 * Mini and Proff are separate products (required for Customer Portal plan switching).
 *
 * Run: pnpm stripe:seed-catalog
 * Requires STRIPE_SECRET_KEY in environment.
 */
import Stripe from "stripe"

// Next.js loads .env.local automatically, but plain `node` does not.
// Load it (and .env as fallback) so the script picks up STRIPE_SECRET_KEY.
if (typeof process.loadEnvFile === "function") {
  for (const envFile of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(envFile)
    } catch {
      // File missing/unreadable — ignore and fall back to existing process env.
    }
  }
}

const secretKey = process.env.STRIPE_SECRET_KEY?.trim()
if (!secretKey) {
  console.error(
    "STRIPE_SECRET_KEY mangler. Legg den i .env.local, eller kjør med:\n" +
      "  STRIPE_SECRET_KEY=sk_... npm run stripe:seed-catalog"
  )
  process.exit(1)
}

const stripe = new Stripe(secretKey)

async function ensureProduct(name, metadata) {
  const existing = await stripe.products.search({
    query: `name:'${name}'`,
    limit: 1,
  })
  if (existing.data[0]) return existing.data[0]
  return stripe.products.create({ name, metadata })
}

async function ensureRecurringPrice(productId, unitAmount, recurring, metadata) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 })
  const match = prices.data.find(
    (p) =>
      p.unit_amount === unitAmount &&
      p.recurring?.interval === recurring.interval &&
      p.metadata?.kind === metadata.kind &&
      (metadata.plan_key ? p.metadata?.plan_key === metadata.plan_key : true) &&
      (metadata.interval ? p.metadata?.interval === metadata.interval : true)
  )
  if (match) return match
  return stripe.prices.create({
    product: productId,
    currency: "nok",
    unit_amount: unitAmount,
    recurring,
    metadata,
  })
}

async function ensureOneTimePrice(productId, unitAmount, metadata) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 })
  const match = prices.data.find(
    (p) =>
      !p.recurring &&
      p.unit_amount === unitAmount &&
      p.metadata?.kind === metadata.kind
  )
  if (match) return match
  return stripe.prices.create({
    product: productId,
    currency: "nok",
    unit_amount: unitAmount,
    metadata,
  })
}

async function main() {
  const miniProduct = await ensureProduct("Proanbud Mini", {
    kind: "base_product",
    plan_key: "mini",
  })
  const proffProduct = await ensureProduct("Proanbud Proff", {
    kind: "base_product",
    plan_key: "proff",
  })
  const overageProduct = await ensureProduct("Proanbud Overforbruk AI-tilbud", {
    kind: "overage_product",
  })
  const moduleProduct = await ensureProduct("Proanbud Timeføring", {
    kind: "module_product",
    module_key: "timeforing",
  })
  const dokumenterProduct = await ensureProduct("Proanbud Dokumenter (Cloud)", {
    kind: "module_product",
    module_key: "dokumenter",
  })
  const integrasjonerProduct = await ensureProduct("Proanbud Integrasjoner", {
    kind: "module_product",
    module_key: "integrasjoner",
  })
  const seatProduct = await ensureProduct("Proanbud Ansatt", { kind: "seat_product" })

  const prices = {
    STRIPE_PRICE_MINI_MONTHLY: await ensureRecurringPrice(
      miniProduct.id,
      19900,
      { interval: "month" },
      { kind: "base", plan_key: "mini", interval: "month" }
    ),
    STRIPE_PRICE_MINI_YEARLY: await ensureRecurringPrice(
      miniProduct.id,
      178800,
      { interval: "year" },
      { kind: "base", plan_key: "mini", interval: "year" }
    ),
    STRIPE_PRICE_PROFF_MONTHLY: await ensureRecurringPrice(
      proffProduct.id,
      34900,
      { interval: "month" },
      { kind: "base", plan_key: "proff", interval: "month" }
    ),
    STRIPE_PRICE_PROFF_YEARLY: await ensureRecurringPrice(
      proffProduct.id,
      346800,
      { interval: "year" },
      { kind: "base", plan_key: "proff", interval: "year" }
    ),
    STRIPE_PRICE_OVERAGE: await ensureOneTimePrice(overageProduct.id, 950, {
      kind: "overage",
    }),
    STRIPE_PRICE_MODULE_TIMEFORING: await ensureRecurringPrice(
      moduleProduct.id,
      2900,
      { interval: "month" },
      { kind: "module", module_key: "timeforing" }
    ),
    STRIPE_PRICE_MODULE_DOKUMENTER: await ensureRecurringPrice(
      dokumenterProduct.id,
      2900,
      { interval: "month" },
      { kind: "module", module_key: "dokumenter" }
    ),
    STRIPE_PRICE_MODULE_INTEGRASJONER: await ensureRecurringPrice(
      integrasjonerProduct.id,
      1900,
      { interval: "month" },
      { kind: "module", module_key: "integrasjoner" }
    ),
    STRIPE_PRICE_SEAT_EMPLOYEE: await ensureRecurringPrice(
      seatProduct.id,
      1900,
      { interval: "month" },
      { kind: "seat" }
    ),
  }

  console.log("\nProdukter:")
  console.log(`  Mini:  ${miniProduct.id}`)
  console.log(`  Proff: ${proffProduct.id}`)

  console.log("\nLegg disse i .env.local:\n")
  for (const [key, price] of Object.entries(prices)) {
    console.log(`${key}=${price.id}`)
  }

  console.log("\nCustomer Portal (Settings → Billing → Customer portal):")
  console.log("  Under 'Products', legg til begge produkter:")
  console.log(`    - Proanbud Mini (${miniProduct.id})`)
  console.log(`    - Proanbud Proff (${proffProduct.id})`)
  console.log("  Slå på: Switch plans, Cancel subscriptions, Update payment methods")

  console.log("\nWebhook URL (lokal dev med Stripe CLI):")
  console.log("  stripe listen --forward-to localhost:3000/api/stripe/webhook")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
