import { describe, expect, it } from "vitest"

import { formatTrialEnd, prettyCompanyName } from "@/lib/resend-crm/format"

describe("prettyCompanyName", () => {
  it("skriver om versaler fra Brreg og beholder selskapsform", () => {
    expect(prettyCompanyName("BYGGMESTER MARIUS THORSEN AS")).toBe("Byggmester Marius Thorsen AS")
    expect(prettyCompanyName("MOLDESTAD FJELLSPRENGNING AS")).toBe("Moldestad Fjellsprengning AS")
    expect(prettyCompanyName("NORILD & AQUATEC AS")).toBe("Norild & Aquatec AS")
    expect(prettyCompanyName("TROMSØ BYGG OG ANLEGG ASA")).toBe("Tromsø Bygg og Anlegg ASA")
    expect(prettyCompanyName("ØSTBY RØR ENK")).toBe("Østby Rør ENK")
  })

  it("lar initialer uten vokal stå, også foran bindestrek", () => {
    expect(prettyCompanyName("DS BYGGTEAM AS")).toBe("DS Byggteam AS")
    expect(prettyCompanyName("MG-MALER AS")).toBe("MG-Maler AS")
  })

  it("rører ikke navn som alt har små bokstaver", () => {
    expect(prettyCompanyName("Hansen Bygg AS")).toBe("Hansen Bygg AS")
    expect(prettyCompanyName("  iTømrer  AS ")).toBe("iTømrer AS")
    expect(prettyCompanyName("")).toBe("")
  })
})

describe("formatTrialEnd", () => {
  it("gir norsk dato uten år", () => {
    expect(formatTrialEnd("2026-10-15T05:18:00Z")).toBe("15. oktober")
    expect(formatTrialEnd(new Date("2026-10-20T13:40:00Z"))).toBe("20. oktober")
  })

  it("bruker norsk tid, ikke UTC", () => {
    // 22:30 UTC den 14. er 00:30 den 15. i Oslo (sommertid).
    expect(formatTrialEnd("2026-10-14T22:30:00Z")).toBe("15. oktober")
  })

  it("tom ved manglende eller ugyldig verdi", () => {
    expect(formatTrialEnd(null)).toBe("")
    expect(formatTrialEnd("tull")).toBe("")
  })
})
