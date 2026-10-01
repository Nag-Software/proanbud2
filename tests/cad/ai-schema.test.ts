import { describe, expect, it } from "vitest"

import { aiSketchSchema, buildingModelFromSketch } from "@/lib/cad/ai-schema"

const outline = [
  { x: 0, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 6 },
  { x: 0, y: 6 },
]

describe("aiSketchSchema er tolerant mot modellens avvik", () => {
  // Gjengir feilene i error_logs 25.–26.09 (gpt-5.6-luna): ukjent takform,
  // etasjehøyde under 1,5 m og en ukjent åpningstype avviste hele skissen.
  it("godtar skissen og faller til standardverdier", () => {
    const result = aiSketchSchema.safeParse({
      storeys: [
        {
          heightM: 0,
          exteriorWallThicknessM: 0,
          outline,
          openings: [
            { kind: "garage_door", at: { x: 2, y: 0 }, widthM: 2.5, heightM: 2.1 },
            { kind: "trapdoor", at: { x: 4, y: 0 }, widthM: 1, heightM: 1 },
            { kind: "window", at: { x: 6, y: 0 }, widthM: 1.2, heightM: 1.2, sillM: 0.9 },
          ],
        },
      ],
      roof: { kind: "hip", pitchDeg: 25 },
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    const storey = result.data.storeys[0]
    expect(storey.heightM).toBeUndefined()
    expect(storey.exteriorWallThicknessM).toBeUndefined()
    expect(storey.openings.map((o) => o.kind)).toEqual(["door", "window"])
    expect(result.data.roof?.kind).toBe("gable")
    expect(result.data.roof?.pitchDeg).toBe(25)

    const model = buildingModelFromSketch(result.data, { fallbackName: "Test", modelUsed: "test" })
    expect(model.storeys[0].height).toBeGreaterThanOrEqual(1.5)
  })

  it("oversetter norske takformer og faller til saltak for ukjente", () => {
    const parse = (kind: string) => aiSketchSchema.parse({ storeys: [{ outline }], roof: { kind } }).roof?.kind
    expect(parse("Pulttak")).toBe("mono")
    expect(parse("flatt")).toBe("flat")
    expect(parse("noe-helt-annet")).toBe("gable")
  })

  it("avviser fortsatt en skisse uten brukbart omriss", () => {
    expect(aiSketchSchema.safeParse({ storeys: [{ outline: [{ x: 0, y: 0 }] }] }).success).toBe(false)
  })
})
