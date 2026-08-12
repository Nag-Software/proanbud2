import { describe, expect, it } from "vitest"

import { assessModelContext } from "@/lib/cad/model-context"

describe("assessModelContext", () => {
  it("godtar så snart det finnes bilder", () => {
    expect(assessModelContext({ description: "", imageCount: 1 }).ok).toBe(true)
  })

  it("avviser tom beskrivelse uten bilder", () => {
    const result = assessModelContext({ description: "", imageCount: 0 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/bilder/i)
  })

  it("avviser veiviserens standardbeskrivelse — den sier ingenting om bygget", () => {
    // Lang tekst, men bare lokasjon og oppgaveliste. Lengde er ikke kontekst.
    const description = "Lokasjon: Storgata 14, 0155 Oslo\nOppgaver: Male vegger | Legge fliser | Rydde"
    expect(assessModelContext({ description, imageCount: 0 }).ok).toBe(false)
  })

  it("godtar beskrivelse med mål", () => {
    expect(assessModelContext({ description: "Bolig på 142 m2 som skal rehabiliteres", imageCount: 0 }).ok).toBe(true)
    expect(assessModelContext({ description: "Tomta er 12 meter bred", imageCount: 0 }).ok).toBe(true)
  })

  it("godtar beskrivelse som faktisk handler om bygget", () => {
    expect(assessModelContext({ description: "Enebolig i to etasjer med saltak", imageCount: 0 }).ok).toBe(true)
    expect(assessModelContext({ description: "Tilbygg på nordsiden", imageCount: 0 }).ok).toBe(true)
  })

  it("regner brukerens egne instruksjoner som kontekst", () => {
    expect(
      assessModelContext({
        description: "Lokasjon: Storgata 14",
        instructions: "Huset har grunnflate 9 x 12 m og loft",
        imageCount: 0,
      }).ok
    ).toBe(true)
  })

  it("romnavn alene er ikke informasjon om bygget", () => {
    expect(assessModelContext({ description: "Oppgaver: Male stue | Pusse opp bad", imageCount: 0 }).ok).toBe(false)
  })
})
