import { afterEach, describe, expect, it, vi } from "vitest"

import {
  getSeatPriceId,
  getStripePriceId,
  newSignupCohort,
  planPricingFor,
  priceCohortFor,
  priceCohortForCompany,
  seatPriceNokFor,
} from "@/lib/billing/plans"

const at = (iso: string) => new Date(iso)

describe("priceCohortFor", () => {
  // Skillet går 8. oktober 2026 kl. 15:00 norsk tid (13:00 UTC).
  it("bedrifter opprettet før prisøkningen beholder gammel pris", () => {
    expect(priceCohortFor("2026-09-20T10:00:00Z", at("2026-11-15T10:00:00Z"))).toBe("legacy")
    expect(priceCohortFor("2026-10-08T12:59:00Z", at("2026-12-01T10:00:00Z"))).toBe("legacy")
  })

  it("bedrifter opprettet etter prisøkningen får ny pris", () => {
    expect(priceCohortFor("2026-10-08T13:00:00Z", at("2026-11-15T10:00:00Z"))).toBe("current")
    expect(priceCohortFor("2027-01-05T10:00:00Z", at("2027-01-06T10:00:00Z"))).toBe("current")
  })

  it("låsen varer i 12 måneder", () => {
    expect(priceCohortFor("2026-09-20T10:00:00Z", at("2027-10-08T12:00:00Z"))).toBe("legacy")
    expect(priceCohortFor("2026-09-20T10:00:00Z", at("2027-10-08T13:00:00Z"))).toBe("current")
  })

  it("ukjent opprettelsesdato gir gammel pris så lenge låsen gjelder", () => {
    expect(priceCohortFor(null, at("2026-12-01T10:00:00Z"))).toBe("legacy")
    expect(priceCohortFor(null, at("2027-12-01T10:00:00Z"))).toBe("current")
  })

  it("nye registreringer følger tidspunktet", () => {
    expect(newSignupCohort(at("2026-10-08T12:00:00Z"))).toBe("legacy")
    expect(newSignupCohort(at("2026-10-08T14:00:00Z"))).toBe("current")
  })
})

describe("priceCohortForCompany", () => {
  const created = "2026-09-20T10:00:00Z"
  const now = at("2026-11-15T10:00:00Z")

  it("levende abonnement opprettet før prisøkningen beholder gammel pris", () => {
    expect(priceCohortForCompany({ createdAt: created, billingStatus: "active" }, now)).toBe("legacy")
    expect(priceCohortForCompany({ createdAt: created, billingStatus: "trialing" }, now)).toBe("legacy")
    expect(priceCohortForCompany({ createdAt: created, billingStatus: "past_due" }, now)).toBe("legacy")
  })

  it("utløpt prøve eller avsluttet abonnement får dagens pris", () => {
    expect(priceCohortForCompany({ createdAt: created, billingStatus: "canceled" }, now)).toBe("current")
    expect(priceCohortForCompany({ createdAt: created, billingStatus: "incomplete" }, now)).toBe("current")
    expect(priceCohortForCompany({ createdAt: created, billingStatus: "unpaid" }, now)).toBe("current")
    expect(priceCohortForCompany({ createdAt: created, billingStatus: null }, now)).toBe("current")
  })

  it("bedrifter opprettet etter prisøkningen får dagens pris uansett", () => {
    expect(
      priceCohortForCompany({ createdAt: "2026-10-20T10:00:00Z", billingStatus: "active" }, now)
    ).toBe("current")
  })
})

describe("priser per kohort", () => {
  it("viser riktige tall", () => {
    expect(planPricingFor("current").proff.month.monthlyNok).toBe(690)
    expect(planPricingFor("current").proff.year.monthlyNok).toBe(590)
    expect(planPricingFor("current").mini.month.monthlyNok).toBe(299)
    expect(planPricingFor("current").mini.year.monthlyNok).toBe(249)
    expect(planPricingFor("legacy").proff.month.monthlyNok).toBe(499)
    expect(seatPriceNokFor("current")).toBe(69)
    expect(seatPriceNokFor("legacy")).toBe(39)
  })
})

describe("Stripe-pris per kohort", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("legacy leser *_LEGACY, current leser hovednøkkelen", () => {
    vi.stubEnv("STRIPE_PRICE_PROFF_MONTHLY", "price_new")
    vi.stubEnv("STRIPE_PRICE_PROFF_MONTHLY_LEGACY", "price_old")
    vi.stubEnv("STRIPE_PRICE_SEAT_EMPLOYEE", "price_seat_new")
    vi.stubEnv("STRIPE_PRICE_SEAT_EMPLOYEE_LEGACY", "price_seat_old")
    expect(getStripePriceId("proff", "month", "current")).toBe("price_new")
    expect(getStripePriceId("proff", "month", "legacy")).toBe("price_old")
    expect(getSeatPriceId("month", "current")).toBe("price_seat_new")
    expect(getSeatPriceId("month", "legacy")).toBe("price_seat_old")
  })

  it("faller tilbake til hovednøkkelen når *_LEGACY ikke er satt", () => {
    vi.stubEnv("STRIPE_PRICE_PROFF_MONTHLY", "price_only")
    vi.stubEnv("STRIPE_PRICE_PROFF_MONTHLY_LEGACY", "")
    expect(getStripePriceId("proff", "month", "legacy")).toBe("price_only")
  })

  it("årlig legacy-sete bruker årlig legacy-pris før månedlig", () => {
    vi.stubEnv("STRIPE_PRICE_SEAT_EMPLOYEE_LEGACY", "price_seat_old_m")
    vi.stubEnv("STRIPE_PRICE_SEAT_EMPLOYEE_YEARLY_LEGACY", "price_seat_old_y")
    expect(getSeatPriceId("year", "legacy")).toBe("price_seat_old_y")
  })
})
