import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const retrieve = vi.fn()
const update = vi.fn()
const rows: { company: { created_at: string | null } | null; billing: Record<string, unknown> | null } = {
  company: null,
  billing: null,
}

vi.mock("@/lib/stripe/server", () => ({ getStripe: () => ({ subscriptions: { retrieve } }) }))
vi.mock("@/lib/errors/log", () => ({ logServerError: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "companies" ? rows.company : rows.billing,
            error: null,
          }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          update(patch)
          return { error: null }
        },
      }),
    }),
  }),
}))

import { getCompanyPriceCohort } from "@/lib/billing/price-cohort"

const BEFORE_CUTOFF = "2026-09-20T10:00:00Z"
const sub = (priceId: string) => ({
  items: { data: [{ price: { id: priceId, metadata: { kind: "base", plan_key: "proff" } } }] },
})

beforeEach(() => {
  retrieve.mockReset()
  update.mockReset()
  vi.stubEnv("STRIPE_PRICE_PROFF_MONTHLY", "price_new")
  vi.stubEnv("STRIPE_PRICE_PROFF_MONTHLY_LEGACY", "price_old")
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-11-15T10:00:00Z"))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("getCompanyPriceCohort", () => {
  it("utløpt prøve får dagens pris selv om bedriften er gammel", async () => {
    rows.company = { created_at: BEFORE_CUTOFF }
    rows.billing = { status: "canceled", stripe_subscription_id: "sub_1" }
    expect(await getCompanyPriceCohort("c1")).toBe("current")
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("levende abonnement følger grunnprisen i Stripe — gammel pris", async () => {
    rows.company = { created_at: BEFORE_CUTOFF }
    rows.billing = { status: "active", stripe_subscription_id: "sub_1" }
    retrieve.mockResolvedValue(sub("price_old"))
    expect(await getCompanyPriceCohort("c1")).toBe("legacy")
  })

  it("gammel bedrift som tegnet nytt til dagens pris forblir på dagens pris", async () => {
    rows.company = { created_at: BEFORE_CUTOFF }
    rows.billing = { status: "active", stripe_subscription_id: "sub_2" }
    retrieve.mockResolvedValue(sub("price_new"))
    expect(await getCompanyPriceCohort("c1")).toBe("current")
    // Stripe-svaret lagres så neste oppslag slipper kallet.
    expect(update).toHaveBeenCalledWith({ price_cohort: "current" })
  })

  it("lagret kohort brukes uten å spørre Stripe", async () => {
    rows.company = { created_at: "2026-10-20T10:00:00Z" }
    rows.billing = { status: "active", stripe_subscription_id: "sub_4", price_cohort: "legacy" }
    expect(await getCompanyPriceCohort("c1")).toBe("legacy")
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("lagret kohort ignoreres når abonnementet ikke lever", async () => {
    rows.company = { created_at: BEFORE_CUTOFF }
    rows.billing = { status: "canceled", stripe_subscription_id: null, price_cohort: "legacy" }
    expect(await getCompanyPriceCohort("c1")).toBe("current")
  })

  it("ukjent pris-ID faller tilbake på opprettelsesdatoen", async () => {
    rows.company = { created_at: BEFORE_CUTOFF }
    rows.billing = { status: "trialing", stripe_subscription_id: "sub_3" }
    retrieve.mockResolvedValue(sub("price_ukjent"))
    expect(await getCompanyPriceCohort("c1")).toBe("legacy")
  })

  it("abonnement som er borte i Stripe gir dagens pris", async () => {
    rows.company = { created_at: BEFORE_CUTOFF }
    rows.billing = { status: "active", stripe_subscription_id: "sub_gone" }
    retrieve.mockRejectedValue({ code: "resource_missing" })
    expect(await getCompanyPriceCohort("c1")).toBe("current")
  })
})
