import { describe, expect, it } from "vitest"

import { buildAnalyseGiftUrl, plusAddress } from "@/lib/outreach/lenker"

describe("buildAnalyseGiftUrl", () => {
  it("fyller ut nettsiden og tar med sporingstokenet", () => {
    const url = buildAnalyseGiftUrl({
      website: "https://holmestrandbygg.no",
      trackingToken: "k7m2xq9pz4",
    })
    const parsed = new URL(url!)
    expect(parsed.pathname).toBe("/analyse")
    expect(parsed.searchParams.get("nettside")).toBe("holmestrandbygg.no")
    expect(parsed.searchParams.get("utm_content")).toBe("k7m2xq9pz4")
    expect(parsed.searchParams.get("utm_source")).toBe("salg")
  })

  it("stripper protokollen, så feltet får det brukeren ville skrevet selv", () => {
    const url = buildAnalyseGiftUrl({ website: "http://vvs-huset.no/", trackingToken: null })
    expect(new URL(url!).searchParams.get("nettside")).toBe("vvs-huset.no/")
  })

  it("gir ingen lenke uten nettside — vi gjetter aldri på domenet", () => {
    expect(buildAnalyseGiftUrl({ website: null, trackingToken: "abc123" })).toBeNull()
  })

  it("virker uten token, bare uten sporing", () => {
    const url = buildAnalyseGiftUrl({ website: "tak-og-blikk.no", trackingToken: null })
    expect(new URL(url!).searchParams.has("utm_content")).toBe(false)
  })
})

describe("plusAddress", () => {
  it("legger tokenet inn i lokaldelen og beholder visningsnavnet", () => {
    expect(plusAddress("Casper Nag <post@proanbud.no>", "abc123")).toBe(
      "Casper Nag <post+abc123@proanbud.no>",
    )
  })

  it("takler en bar adresse", () => {
    expect(plusAddress("post@proanbud.no", "abc123")).toBe("post+abc123@proanbud.no")
  })

  it("lar noe som ikke er en adresse være i fred", () => {
    expect(plusAddress("ikke en adresse", "abc123")).toBe("ikke en adresse")
  })
})
