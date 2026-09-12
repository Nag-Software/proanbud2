import { describe, expect, it } from "vitest"

import {
  checkColdEmailGates,
  classifyContactEmail,
  collectGateReasons,
  contactPolicyFor,
  domainFromWebsite,
  type GateInput,
} from "@/lib/outreach/gates"

describe("classifyContactEmail", () => {
  // Ekte tilfeller fra prospektlisten 2026-09-11.
  it.each([
    ["post@hushage.net", "ALT MED HUS OG HAGE AS", null, [], "generisk_firmadomene"],
    ["kontakt@ailema.as", "AILEMA AS", null, [], "generisk_firmadomene"],
    ["post@eggerud.com", "SKIRVEDALEN FJELLSERVICE AS", "eggerud.com", [], "generisk_firmadomene"],
    ["timrebygg@gmail.com", "TIMRE BYGG & DESIGN AS", null, [], "firmanavn_freemail"],
    ["exargroup@gmail.com", "EXAR BYGG AS", "exargroup.no", [], "firmanavn_freemail"],
    ["montasjeisor@gmail.com", "MONTASJE I SØR AS", null, [], "firmanavn_freemail"],
    ["arnejohan.haugen@gmail.com", "FOLLO ENTREPRENØR AS", null, [], "personnavn"],
    ["jurgis.jurgaitis397@gmail.com", "AR BYGG OG MASKIN AS", null, [], "personnavn"],
    ["kris_ter@hotmail.com", "KO BYGG AS", null, [], "personnavn"],
    ["martin_sh@hotmail.no", "SAND-HANSSEN BYGG AS", null, [], "personnavn"],
    ["erik.stolpe@gmail.com", "TETT & RENT COATING ASKER AS", null, [], "personnavn"],
    ["e.lunn@hotmail.no", "LUNN BYGG AS", null, [], "personnavn"],
    ["roy@k1hytter.no", "K1 HYTTER AS", null, ["Roy Magne Storholm"], "personnavn"],
    ["erik@bautarehab.no", "TØMRERLANDSLAGET AS", null, [], "personnavn"],
    ["kasperjohansen@outlook.com", "KASPER JOHANSEN TØMRERSERVICE", null, [], "personnavn"],
    ["kristianfuglevik1@gmail.com", "FUGLEVIK HÅNDVERK", null, [], "personnavn"],
  ])("%s for %s → %s", (email, companyName, companyDomain, personNames, expected) => {
    expect(classifyContactEmail(email, { companyName, companyDomain, personNames })).toBe(expected)
  })

  it("lar etternavn som er firmanavnet stå som firmaadresse når det ikke er en initial foran", () => {
    expect(
      classifyContactEmail("lunnbygg@gmail.com", { companyName: "LUNN BYGG AS", personNames: ["Erik Lunn"] }),
    ).toBe("firmanavn_freemail")
    expect(
      classifyContactEmail("elunn@gmail.com", { companyName: "LUNN BYGG AS", personNames: ["Erik Lunn"] }),
    ).toBe("personnavn")
  })

  it("fanger forkortet fornavn + etternavn fra rollene (ekte tilfelle)", () => {
    expect(
      classifyContactEmail("hjajohansen@gmail.com", {
        companyName: "H.M MONTASJESERVICE V/HJALMAR JOHANSEN",
        personNames: ["Hjalmar Johansen"],
      }),
    ).toBe("personnavn")
    expect(
      classifyContactEmail("johansen@gmail.com", { companyName: "JOHANSEN BYGG AS", personNames: ["Ole Johansen"] }),
    ).toBe("personnavn")
  })

  it("fanger fornavn + etternavn selv når etternavnet er i firmanavnet", () => {
    expect(classifyContactEmail("olejohansen@gmail.com", { companyName: "JOHANSEN BYGG AS" })).toBe("personnavn")
    expect(classifyContactEmail("ole@johansenbygg.no", { companyName: "JOHANSEN BYGG AS" })).toBe("personnavn")
  })

  it("krever at freemail-adressen faktisk inneholder firmanavnet", () => {
    expect(classifyContactEmail("byggmester123@gmail.com", { companyName: "TIMRE BYGG AS" })).toBe("ukjent")
  })

  it("avviser systemadresser og ugyldig syntaks", () => {
    expect(classifyContactEmail("noreply@firma.no", { companyName: "FIRMA AS" })).toBe("ugyldig")
    expect(classifyContactEmail("ikke-en-adresse", { companyName: "FIRMA AS" })).toBe("ugyldig")
  })

  it("regner et tredjepartsdomene som ukjent når lokaldelen er en rolle", () => {
    expect(classifyContactEmail("post@regnskapsbyraa.no", { companyName: "TIMRE BYGG AS" })).toBe("ukjent")
  })

  it("bruker firmaets nettside-domene når det er kjent", () => {
    expect(
      classifyContactEmail("firmapost@nordbygg.no", { companyName: "NORDLYS AS", companyDomain: "nordbygg.no" }),
    ).toBe("generisk_firmadomene")
  })
})

describe("domainFromWebsite", () => {
  it("normaliserer nettadresser", () => {
    expect(domainFromWebsite("www.exargroup.no")).toBe("exargroup.no")
    expect(domainFromWebsite("https://www.eggerud.com/om-oss")).toBe("eggerud.com")
    expect(domainFromWebsite(null)).toBeNull()
  })
})

const baseInput: GateInput = {
  segment: "handverker",
  orgForm: "AS",
  employeeCount: 8,
  hasEmail: true,
  emailClass: "generisk_firmadomene",
}

describe("checkColdEmailGates", () => {
  it("slipper gjennom et AS med 5–20 ansatte og generell adresse", () => {
    expect(checkColdEmailGates(baseInput)).toEqual({ ok: true })
  })

  it("stopper ENK alltid — også når Casper sender selv", () => {
    const enk = { ...baseInput, orgForm: "ENK" }
    expect(checkColdEmailGates(enk, "auto")).toMatchObject({ ok: false, reason: "orgform_enk" })
    expect(checkColdEmailGates(enk, "manual")).toMatchObject({ ok: false, reason: "orgform_enk" })
  })

  it("stopper personlige adresser i begge moduser, men målgruppe bare i auto", () => {
    const personal = { ...baseInput, emailClass: "personnavn" as const }
    expect(checkColdEmailGates(personal, "manual")).toMatchObject({ ok: false, reason: "epost_personnavn", phoneOnly: true })

    const small = { ...baseInput, employeeCount: null }
    expect(checkColdEmailGates(small, "auto")).toMatchObject({ ok: false, reason: "ansatte_utenfor" })
    expect(checkColdEmailGates(small, "manual")).toEqual({ ok: true })
  })

  it("krever kjent eierskap til adressen i auto", () => {
    const unknown = { ...baseInput, emailClass: "ukjent" as const }
    expect(checkColdEmailGates(unknown, "auto")).toMatchObject({ ok: false, reason: "epost_ukjent" })
    expect(checkColdEmailGates(unknown, "manual")).toEqual({ ok: true })
  })

  it("stopper avmeldte i begge moduser", () => {
    const optedOut = { ...baseInput, optedOut: true }
    expect(checkColdEmailGates(optedOut, "manual")).toMatchObject({ ok: false, reason: "avmeldt" })
  })

  it("regnskapspartnere kan ha under 5 ansatte (Brreg viser ikke tallet)", () => {
    expect(checkColdEmailGates({ ...baseInput, segment: "regnskapspartner", employeeCount: null })).toEqual({ ok: true })
  })
})

describe("contactPolicyFor", () => {
  it("gir samlet dom fra grunnene", () => {
    expect(contactPolicyFor([])).toBe("epost_ok")
    expect(contactPolicyFor(collectGateReasons({ ...baseInput, emailClass: "personnavn" }))).toBe("kun_telefon")
    expect(contactPolicyFor(collectGateReasons({ ...baseInput, orgForm: "ENK" }))).toBe("utenfor_icp")
    expect(contactPolicyFor(collectGateReasons({ ...baseInput, optedOut: true }))).toBe("blokkert")
    expect(contactPolicyFor(collectGateReasons({ ...baseInput, orgForm: null }))).toBe("ukjent")
  })
})
