import { describe, expect, it } from "vitest"

import {
  detectSignals,
  extractPage,
  htmlToText,
  pickSubpages,
} from "@/lib/outreach/research/extract"

const HTML = `<!doctype html>
<html><head><title>Holmestrand Bygg AS — tømrer i Vestfold</title>
<style>.x{color:red}</style><script>var a = "ikke tekst"</script></head>
<body>
<nav><a href="/">Hjem</a><a href="/tjenester">Tjenester</a><a href="/om-oss">Om oss</a>
<a href="/referanser">Referanser</a><a href="/kontakt">Kontakt</a>
<a href="/ledige-stillinger">Ledige stillinger</a><a href="/personvern">Personvern</a>
<a href="https://facebook.com/holmestrandbygg">Facebook</a></nav>
<h1>Tømrer i Holmestrand</h1>
<p>Vi bygger tilbygg, garasjer og p&aring;bygg for privatkunder i hele Vestfold.</p>
<p>Be om et uforpliktende tilbud &ndash; vi kommer p&aring; befaring innen en uke.</p>
<p>Kontakt: <a href="mailto:Post@holmestrandbygg.no">Post@holmestrandbygg.no</a>
eller ring 33 05 12 34.</p>
</body></html>`

describe("htmlToText", () => {
  it("fjerner skript og stil, og beholder den lesbare teksten", () => {
    const text = htmlToText(HTML)
    expect(text).not.toContain("ikke tekst")
    expect(text).not.toContain("color:red")
    expect(text).toContain("Tømrer i Holmestrand")
  })

  it("dekoder entiteter, også de norske", () => {
    expect(htmlToText(HTML)).toContain("påbygg")
    expect(htmlToText(HTML)).toContain("uforpliktende tilbud –")
  })

  it("skiller avsnitt med blank linje, ikke sammenklistret tekst", () => {
    expect(htmlToText("<p>En</p><p>To</p>")).toBe("En\n\nTo")
  })
})

describe("extractPage", () => {
  const page = extractPage(HTML, "https://holmestrandbygg.no/")

  it("henter tittelen", () => {
    expect(page.title).toBe("Holmestrand Bygg AS — tømrer i Vestfold")
  })

  it("tar bare interne lenker, og dropper eksterne", () => {
    expect(page.links).toContain("https://holmestrandbygg.no/tjenester")
    expect(page.links.some((link) => link.includes("facebook"))).toBe(false)
  })

  it("finner e-post fra mailto og normaliserer til små bokstaver", () => {
    expect(page.emails).toContain("post@holmestrandbygg.no")
  })

  it("finner norsk telefonnummer uten mellomrom", () => {
    expect(page.phones).toContain("33051234")
  })
})

describe("pickSubpages", () => {
  const page = extractPage(HTML, "https://holmestrandbygg.no/")

  it("velger én side per kategori, i prioritert rekkefølge", () => {
    const picked = pickSubpages(page.links, "https://holmestrandbygg.no/", 5)
    expect(picked[0]).toContain("/tjenester")
    expect(picked).toContain("https://holmestrandbygg.no/om-oss")
    expect(picked).toContain("https://holmestrandbygg.no/referanser")
    expect(picked).toContain("https://holmestrandbygg.no/kontakt")
  })

  it("hopper over personvern og andre sider uten salgsverdi", () => {
    const picked = pickSubpages(page.links, "https://holmestrandbygg.no/", 5)
    expect(picked.some((url) => url.includes("personvern"))).toBe(false)
  })

  it("respekterer grensen", () => {
    expect(pickSubpages(page.links, "https://holmestrandbygg.no/", 2)).toHaveLength(2)
  })
})

describe("detectSignals", () => {
  const pages = [extractPage(HTML, "https://holmestrandbygg.no/")]
  const signals = detectSignals(pages)
  const get = (key: string) => signals.find((signal) => signal.key === key)!

  it("finner tilbudsskjema med ordrett belegg og kilde", () => {
    const signal = get("tilbudsskjema")
    expect(signal.met).toBe(true)
    expect(signal.evidence).toContain("uforpliktende tilbud")
    expect(signal.source_url).toBe("https://holmestrandbygg.no/")
  })

  it("finner privatmarked", () => {
    expect(get("privatmarked").met).toBe(true)
  })

  it("melder ikke treff på det som ikke står der", () => {
    expect(get("regnskapsverktoy").met).toBe(false)
    expect(get("regnskapsverktoy").evidence).toBe("")
    expect(get("sentral_godkjenning").met).toBe(false)
  })

  it("gir alltid et svar per signal, også på tom side", () => {
    const empty = detectSignals([])
    expect(empty).toHaveLength(signals.length)
    expect(empty.every((signal) => signal.met === false)).toBe(true)
  })
})
