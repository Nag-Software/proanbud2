import { describe, expect, it } from "vitest"

import { emailDomainCandidate, guessDomains } from "@/lib/outreach/research/domene"

describe("emailDomainCandidate", () => {
  it("bruker domenet til en firmaadresse", () => {
    expect(emailDomainCandidate("post@holmestrandbygg.no")).toBe("holmestrandbygg.no")
    expect(emailDomainCandidate("Kontakt@Tak-og-Blikk.no")).toBe("tak-og-blikk.no")
    expect(emailDomainCandidate("post@mail.firma.no")).toBe("firma.no")
  })

  it("bruker aldri Gmail, Online o.l. — der bor tusenvis av firmaer", () => {
    expect(emailDomainCandidate("timrebygg@gmail.com")).toBeNull()
    expect(emailDomainCandidate("post@online.no")).toBeNull()
    expect(emailDomainCandidate("firma@altibox.no")).toBeNull()
  })

  it("bruker aldri en katalog, og tåler tomt og ugyldig", () => {
    expect(emailDomainCandidate("firma@facebook.com")).toBeNull()
    expect(emailDomainCandidate(null)).toBeNull()
    expect(emailDomainCandidate("ikke-en-adresse")).toBeNull()
  })
})

describe("guessDomains", () => {
  it("gjetter de vanlige formene, mest sannsynlig først", () => {
    expect(guessDomains("Holmestrand Bygg og Tak AS")).toEqual([
      "holmestrandbyggogtak.no",
      "holmestrandbyggtak.no",
      "holmestrand-bygg-og-tak.no",
      "holmestrand-bygg-tak.no",
      "holmestrandbyggogtakas.no",
    ])
  })

  it("skriver om æøå slik norske domener gjør", () => {
    expect(guessDomains("Bygg og Sønner AS")[0]).toBe("byggogsonner.no")
    expect(guessDomains("Rørleggerservice Ås AS")[0]).toBe("rorleggerserviceas.no")
  })

  it("tar med formen med «as» til slutt", () => {
    expect(guessDomains("Malerhuset AS")).toContain("malerhusetas.no")
  })

  it("lager ingen gjett av et navn uten innhold", () => {
    expect(guessDomains("AS")).toEqual([])
    expect(guessDomains("")).toEqual([])
  })

  it("holder seg innenfor det et domene kan være", () => {
    for (const domain of guessDomains("Aas & Co. (Vestfold) Bygg-Service AS")) {
      expect(domain).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.no$/)
    }
  })
})
