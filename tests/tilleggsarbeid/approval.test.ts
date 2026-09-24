import { describe, expect, it, vi } from "vitest"

import { describeChangeOrderStatus, isManualApprovalBasis } from "@/lib/tilleggsarbeid/approval.shared"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/errors/log", () => ({ logServerError: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))

describe("describeChangeOrderStatus", () => {
  it("sier hvem som godkjente når kunden svarte via lenken", () => {
    expect(describeChangeOrderStatus({ status: "accepted", approval_basis: "customer_otp", accepted_by_name: "Kari Hansen" })).toEqual({
      label: "Godkjent av Kari Hansen",
      tone: "ok",
    })
  })

  it("viser grunnlaget når håndverkeren registrerte avtalen", () => {
    expect(describeChangeOrderStatus({ status: "accepted", approval_basis: "urgent_work" }).label).toBe("Hastearbeid")
    expect(describeChangeOrderStatus({ status: "accepted", approval_basis: "agreed_on_site" }).label).toBe("Avtalt muntlig")
  })

  it("kaller eldre rader uten grunnlag «Registrert» – ikke «Godkjent», som ingen kunde har sagt", () => {
    expect(describeChangeOrderStatus({ status: "accepted", approval_basis: null }).label).toBe("Registrert")
  })

  it("viser at sendte venter på kunden", () => {
    expect(describeChangeOrderStatus({ status: "sent" })).toEqual({ label: "Venter på kunden", tone: "waiting" })
    expect(describeChangeOrderStatus({ status: "draft" }).label).toBe("Ikke sendt")
  })
})

describe("isManualApprovalBasis", () => {
  it("lar ikke håndverkeren sette kundens egen godkjenning", () => {
    expect(isManualApprovalBasis("agreed_in_writing")).toBe(true)
    expect(isManualApprovalBasis("customer_otp")).toBe(false)
    expect(isManualApprovalBasis("tull")).toBe(false)
  })
})

describe("hashChangeOrderDocument", () => {
  it("gir samme hash for samme innhold og ny hash når beløpet endres", async () => {
    const { hashChangeOrderDocument } = await import("@/lib/tilleggsarbeid/approval")
    const document = {
      id: "co-1",
      title: "Bytte svill",
      description: null,
      amountNok: 4500,
      billingType: "fixed",
      hourlyRateNok: null,
      estimatedHours: null,
    }
    expect(hashChangeOrderDocument(document)).toBe(hashChangeOrderDocument({ ...document }))
    expect(hashChangeOrderDocument({ ...document, amountNok: 4600 })).not.toBe(hashChangeOrderDocument(document))
  })
})
