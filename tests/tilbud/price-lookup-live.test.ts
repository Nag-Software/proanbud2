// Live-verifisering av verktøyløkka mot OpenAI.
//
// Hvorfor denne finnes: resten av testene beviser at oppslaget og prisbyttet er
// riktig, men IKKE at wire-formatet på function calling er det OpenAI faktisk
// forventer. Det er den ene tingen enhetstester ikke kan svare på, og den ligger
// i en levende kundefunksjon.
//
// Kjøres bare når du ber om det, fordi den bruker et ekte (lite) OpenAI-kall:
//
//   LIVE_LLM=1 npx vitest run tests/tilbud/price-lookup-live.test.ts
//
// Den rører ingen database og lagrer ingenting — kun OpenAI + en prisliste i minnet.

import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

import {
  PRICE_LOOKUP_TOOL,
  PRICE_LOOKUP_TOOL_NAME,
  buildPriceRowIndex,
  runPriceLookup,
} from "@/lib/tilbud/price-lookup"
import type { CompanyPriceRow } from "@/lib/tilbud/company-price-utils"

/** Vitest laster ikke .env.local av seg selv. */
function loadEnvLocal() {
  if (process.env.OPENAI_API_KEY) return
  try {
    const raw = readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!match) continue
      const [, key, value] = match
      if (!process.env[key]) process.env[key] = value.trim().replace(/^["']|["']$/g, "")
    }
  } catch {
    // .env.local finnes ikke — testen hopper over under.
  }
}

loadEnvLocal()

const ENABLED = process.env.LIVE_LLM === "1" && Boolean(process.env.OPENAI_API_KEY)

const ROWS: CompanyPriceRow[] = [
  {
    id: "row-gips",
    product: "Gipsplate standard 13mm 1200x2400",
    unit: "stk",
    net_price: 129.5,
    list_price: 189,
    category: "Gips",
    nobb: "11112222",
    supplier_sku: "GIPS-13",
    supplier_name: "Optimera",
  },
  {
    id: "row-membran",
    product: "Våtromsmembran 15 kg spann",
    unit: "spann",
    net_price: 1849,
    list_price: 2199,
    category: "Våtrom",
    nobb: "33334444",
    supplier_sku: "MEMB-15",
    supplier_name: "Optimera",
  },
]

describe.skipIf(!ENABLED)("verktøyløkka mot ekte OpenAI-API", () => {
  const index = buildPriceRowIndex(ROWS)
  let model: string

  beforeAll(() => {
    model = process.env.OPENAI_MODEL || "gpt-5.2-mini"
  })

  async function callResponses(body: Record<string, unknown>) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(`OpenAI ${response.status}: ${text.slice(0, 600)}`)
    }

    return JSON.parse(text) as {
      output: Array<{ type: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type: string; text?: string }> }>
    }
  }

  it("godtar verktøydefinisjonen og kaller sok_prisfil", async () => {
    const first = await callResponses({
      model,
      instructions: "Du er kalkulatør. Bruk sok_prisfil for å finne prisen før du svarer.",
      tools: [PRICE_LOOKUP_TOOL],
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Hva koster en gipsplate 13mm hos oss? Slå det opp." }],
        },
      ],
    })

    const calls = first.output.filter((o) => o.type === "function_call" && o.name === PRICE_LOOKUP_TOOL_NAME)
    expect(calls.length, "modellen kalte ikke verktøyet").toBeGreaterThan(0)

    const call = calls[0]!
    const args = JSON.parse(call.arguments || "{}")
    expect(typeof args.sporring).toBe("string")

    // Runde 2: mat resultatet tilbake i samme format som ruta gjør.
    const lookup = runPriceLookup(index, args)
    const second = await callResponses({
      model,
      instructions:
        "Du er kalkulatør. Svar KUN med JSON: {\"pris\": <tall>, \"radId\": \"<radId>\"} for produktet brukeren spurte om.",
      tools: [PRICE_LOOKUP_TOOL],
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: "Hva koster en gipsplate 13mm hos oss? Slå det opp." }],
        },
        { type: "function_call", call_id: call.call_id, name: call.name, arguments: call.arguments || "{}" },
        { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(lookup) },
      ],
    })

    const answer = second.output
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("")

    expect(answer, "modellen svarte ikke etter verktøysvaret").not.toBe("")
    // Det viktigste: den refererer raden vår, ikke et selvoppfunnet tall.
    expect(answer).toContain("row-gips")
  }, 240_000)
})
