import { describe, expect, it } from "vitest"

import { isOrgNumber, mapBrregEnhetToProfile } from "@/lib/brreg/company-profile"

describe("mapBrregEnhetToProfile", () => {
  it("henter adresse, mva og fag fra Enhetsregisteret", () => {
    expect(
      mapBrregEnhetToProfile({
        organisasjonsnummer: "933909336",
        navn: "PROFFBUD AS",
        registrertIMvaregisteret: true,
        naeringskode1: { kode: "43.210", beskrivelse: "Elektrisk installasjonsarbeid" },
        forretningsadresse: { adresse: ["Løkkeveien 5"], postnummer: "0253", poststed: "OSLO" },
      })
    ).toEqual({ address: "Løkkeveien 5", postalCode: "0253", city: "Oslo", vatRegistered: true, industry: "elektriker" })
  })

  it("lar fag stå tomt når det ikke finnes en tydelig match, og mva ukjent når Brreg ikke sier det", () => {
    const profile = mapBrregEnhetToProfile({
      organisasjonsnummer: "123456789",
      navn: "Test AS",
      naeringskode1: { kode: "43.330", beskrivelse: "Gulvlegging og tapetsering" },
      forretningsadresse: { poststed: "MO I RANA" },
    })
    expect(profile.industry).toBeNull()
    expect(profile.vatRegistered).toBeNull()
    expect(profile.city).toBe("Mo i Rana")
    expect(profile.address).toBeNull()
  })
})

describe("isOrgNumber", () => {
  it("godtar ni sifre, også med mellomrom", () => {
    expect(isOrgNumber("933 909 336")).toBe(true)
    expect(isOrgNumber("93390933")).toBe(false)
    expect(isOrgNumber(null)).toBe(false)
  })
})
