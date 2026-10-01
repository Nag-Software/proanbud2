import { describe, expect, it } from "vitest"

import { withSupportedParams } from "@/lib/llm/openai-fetch"

describe("withSupportedParams", () => {
  // error_logs 30.09: «temperature does not support 0.2 with this model» — KI-
  // sammendraget i tilbud falt stille tilbake til standardteksten.
  it("fjerner temperature/top_p for gpt-5- og o-modeller", () => {
    expect(withSupportedParams({ model: "gpt-5.6-luna", temperature: 0.2, top_p: 0.9, messages: [] })).toEqual({
      model: "gpt-5.6-luna",
      messages: [],
    })
    expect(withSupportedParams({ model: "o4-mini", temperature: 0.4 })).toEqual({ model: "o4-mini" })
  })

  it("lar eldre modeller beholde temperature", () => {
    const body = { model: "gpt-4.1-mini", temperature: 0.2 }
    expect(withSupportedParams(body)).toBe(body)
  })
})
