import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const inserted: Array<Record<string, unknown>> = []
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserted.push(row)
        return { error: null }
      },
    }),
  }),
}))

const { logServerError } = await import("@/lib/errors/log")

describe("logServerError", () => {
  it("tar vare på koden og detaljene fra en Supabase-feil", async () => {
    // PostgrestError er et vanlig objekt, ikke en Error — før ble årsaken borte.
    await logServerError({
      message: "Kunne ikke hente firmaer (platform)",
      error: {
        code: "PGRST201",
        message: "Could not embed because more than one relationship was found",
        details: "companies with users",
        hint: "Try changing 'users'",
      },
    })

    expect(inserted.at(-1)).toMatchObject({
      message: "Kunne ikke hente firmaer (platform)",
      stack:
        "PGRST201: Could not embed because more than one relationship was found\ncompanies with users\nHint: Try changing 'users'",
    })
  })

  it("bruker fortsatt stacken til en vanlig Error", async () => {
    const error = new Error("boom")
    await logServerError({ message: "Feil", error })
    expect(inserted.at(-1)?.stack).toBe(error.stack)
  })
})
