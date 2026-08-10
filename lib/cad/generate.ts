import "server-only"

/**
 * KI-generering av bygningsmodell fra prosjektbeskrivelse og bilder.
 *
 * Bildene er ikke pynt: de er ofte det eneste stedet hvor takform, antall
 * vinduer og fasadeoppdeling faktisk står. Derfor kjøres de gjennom en
 * vision-modell sammen med teksten.
 *
 * Modellen svarer i skisseformatet (se ai-schema.ts), ikke i den interne
 * datamodellen — og alt valideres og bygges opp på nytt her. Det gjør at et
 * dårlig svar gir en tom eller forenklet modell, aldri en ødelagt en.
 */

import { openaiFetch } from "@/lib/llm/openai-fetch"
import { logServerError } from "@/lib/errors/log"

import { AI_SKETCH_FORMAT, aiSketchSchema, buildingModelFromSketch } from "./ai-schema"
import type { BuildingModel } from "./types"

const SYSTEM_PROMPT = [
  "Du er en norsk bygningsingeniør som lager presise, forenklede 3D-arbeidsmodeller av småhusprosjekter.",
  "Du får en prosjektbeskrivelse og ofte bilder av bygget eller tomta. Du skal returnere ÉN JSON-skisse av bygget.",
  "",
  "HARDE KRAV:",
  "- Alle mål er i METER, med desimaler. Ingen enheter i tallene.",
  "- `outline` er byggets ytre omriss langs veggenes SENTERLINJE, i rekkefølge rundt bygget, uten å gjenta første punkt til slutt.",
  "- Omrisset må være lukket og ikke krysse seg selv. Hold hjørnene rettvinklede med mindre beskrivelsen eller bildene tydelig viser noe annet.",
  "- Legg origo (0,0) i et hjørne av bygget. Positiv x mot øst, positiv y mot nord.",
  "- `interiorWalls` er skillevegger. Endepunktene skal ligge PÅ en yttervegg eller på en annen skillevegg, ellers blir ikke rommet lukket.",
  "- Åpninger oppgis som et punkt `at` som ligger PÅ vegglinja den skal stå i (maks noen få centimeter unna).",
  "- `rooms` er navn plassert i et punkt INNE i rommet. Bruk norske romnavn (Stue, Kjøkken, Bad, Soverom, Gang, Bod, Vaskerom, Garasje).",
  "",
  "FAGLIGE STANDARDVERDIER (bruk når beskrivelsen ikke sier noe annet):",
  "- Romhøyde 2,4 m. Yttervegg 0,25 m. Innervegg 0,10 m. Bærevegg 0,15 m.",
  "- Ytterdør 1,0 × 2,1 m. Innerdør 0,9 × 2,0 m. Vindu 1,2 × 1,2 m med brystning 0,9 m.",
  "- Saltak 30°, takutstikk 0,4 m.",
  "- Bad minst 4 m², soverom minst 7 m², gang minst 1,2 m bredt.",
  "",
  "ARBEIDSMÅTE:",
  "1. Finn arealet. Er BRA eller ytre mål oppgitt, bruk det. Er bare areal oppgitt, velg et realistisk rektangel eller L.",
  "2. Del inn i rom som gir et fornuftig planløsning for et norsk hus, med gang/entré som bindeledd.",
  "3. Plasser dører der man må kunne gå, og vinduer i yttervegger i oppholdsrom.",
  "4. Skriv i `assumptions` alt du har gjettet på. Vær ærlig — brukeren skal kunne rette opp.",
  "",
  "Svar KUN med gyldig JSON i dette formatet, uten tekst rundt og uten kodeblokk:",
  AI_SKETCH_FORMAT,
].join("\n")

export type GenerateModelInput = {
  projectName: string
  description: string
  projectType?: string | null
  location?: string | null
  budgetNok?: number | null
  imageUrls?: string[]
  /** Fritekst fra brukeren i «Generer på nytt»-dialogen. */
  instructions?: string | null
}

export type GenerateModelResult =
  | { ok: true; model: BuildingModel; usedModel: string; assumptions: string[] }
  | { ok: false; error: string }

const MAX_IMAGES = 6
const MAX_DESCRIPTION_CHARS = 6000

/**
 * Full oppløsning på bildene.
 *
 * `low` skalerer bildet til 512×512 før modellen ser det. Det er nok til å se
 * at «dette er et hus», men ikke til å telle vinduer på en fasade eller lese av
 * en takvinkel — som er nettopp det vi ber om. Genereringen kjøres én gang per
 * prosjekt, så de ekstra tokenene er uten praktisk betydning her.
 */
const IMAGE_DETAIL = "high"

function buildUserContent(input: GenerateModelInput) {
  const lines = [
    `Prosjekt: ${input.projectName}`,
    input.projectType ? `Type: ${input.projectType}` : "",
    input.location ? `Sted: ${input.location}` : "",
    input.budgetNok ? `Budsjett: ${Math.round(input.budgetNok)} kr` : "",
    "",
    "Beskrivelse:",
    (input.description || "Ingen beskrivelse oppgitt.").slice(0, MAX_DESCRIPTION_CHARS),
  ].filter(Boolean)

  if (input.instructions?.trim()) {
    lines.push("", "Ekstra instruksjoner fra brukeren (høyest prioritet):", input.instructions.trim())
  }

  const images = (input.imageUrls ?? []).slice(0, MAX_IMAGES)
  if (images.length > 0) {
    lines.push(
      "",
      `${images.length} bilde(r) av prosjektet følger. Bruk dem til å lese av takform, etasjer, vindusinndeling og proporsjoner.`
    )
  }

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: string } }
  > = [{ type: "text", text: lines.join("\n") }]

  for (const url of images) {
    content.push({ type: "image_url", image_url: { url, detail: IMAGE_DETAIL } })
  }

  return content
}

function stripCodeFence(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("```")) return trimmed
  return trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim()
}

export async function generateBuildingModel(
  input: GenerateModelInput
): Promise<GenerateModelResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: "KI-generering er ikke satt opp. Kontakt support." }
  }

  // CAD-modellen bør være eksplisitt satt separat, så en generell og ofte
  // billigere OPENAI_MODEL ikke får senke kvaliteten her.
  const usedModel = process.env.OPENAI_CAD_MODEL || "gpt-5.2"

  // gpt-5-familien avviser `temperature` med 400, og openaiFetch prøver ikke om
  // igjen på klientfeil — da hadde genereringen bare dødd. Samme håndtering som
  // callOpenAiResponses i ai-chat.
  const supportsTemperature = !usedModel.toLowerCase().startsWith("gpt-5")

  try {
    const response = await openaiFetch(
      "chat/completions",
      {
        model: usedModel,
        ...(supportsTemperature ? { temperature: 0.2 } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserContent(input) },
        ],
      },
      // Vision + stor JSON tar tid. 120 s per forsøk og ett ekstra forsøk
      // holder oss innenfor rutens maxDuration på 300 s.
      { timeoutMs: 120_000, retries: 1 }
    )

    const payload = (await response.json()) as {
      model?: string
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = payload.choices?.[0]?.message?.content
    if (!raw) {
      return { ok: false, error: "KI-en svarte tomt. Prøv igjen." }
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(stripCodeFence(raw))
    } catch {
      return { ok: false, error: "KI-en svarte i feil format. Prøv igjen." }
    }

    const sketch = aiSketchSchema.safeParse(parsedJson)
    if (!sketch.success) {
      await logServerError({
        message: "KI-skissen bestod ikke validering",
        error: sketch.error,
        source: "api",
        route: "generateBuildingModel",
        context: { projectName: input.projectName, usedModel },
      })
      return {
        ok: false,
        error: "KI-en klarte ikke å lage en gyldig plan. Prøv å beskrive bygget litt mer konkret.",
      }
    }

    const model = buildingModelFromSketch(sketch.data, {
      fallbackName: input.projectName,
      modelUsed: payload.model || usedModel,
    })

    const wallCount = model.storeys.reduce((sum, storey) => sum + storey.walls.length, 0)
    if (wallCount < 3) {
      return {
        ok: false,
        error: "Modellen ble for tynn til å bruke. Legg til mer i beskrivelsen og prøv igjen.",
      }
    }

    return {
      ok: true,
      model,
      usedModel: payload.model || usedModel,
      assumptions: sketch.data.assumptions,
    }
  } catch (error) {
    await logServerError({
      message: "Kunne ikke generere 3D-modell",
      error,
      source: "api",
      route: "generateBuildingModel",
      context: { projectName: input.projectName },
    })
    return { ok: false, error: "Kunne ikke generere modellen akkurat nå. Prøv igjen om litt." }
  }
}
