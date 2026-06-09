import { NextResponse } from "next/server"
import mammoth from "mammoth"
import { PDFParse } from "pdf-parse"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import {
  buildAiPriceSelectionContext,
  finalizeGeneratedOfferLineItems,
  type CompanyPriceFileMeta,
  type CompanyPricePromptAttachment,
  type CompanyPriceRow,
} from "@/lib/tilbud/company-price-utils"
import { matchNorwegianSupplierPrices } from "@/lib/tilbud/supplier-prices"
import { type OfferAnalysisResult, type OfferLineItem } from "@/lib/tilbud/types"

const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sizeBytes: z.number().min(0),
  type: z.string().optional(),
  storageBucket: z.string().optional(),
  storagePath: z.string().optional(),
  signedUrl: z.string().optional(),
  uploadedAt: z.string().optional(),
  uploadStatus: z.enum(["pending", "uploading", "ready", "failed"]).optional(),
  previewKind: z.enum(["image", "document"]).optional(),
})

const companySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    orgNumber: z.string().nullable(),
  })
  .nullable()

const projectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    customerId: z.string().uuid().nullable(),
    customerName: z.string().nullable(),
    customerEmail: z.string().nullable(),
    customerPhone: z.string().nullable(),
    description: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    projectType: z.string().nullable().optional(),
    budgetNok: z.number().nullable().optional(),
  })
  .nullable()

const customerSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    city: z.string().nullable(),
    address: z.string().nullable().optional(),
    postalCode: z.string().nullable().optional(),
    orgNumber: z.string().nullable().optional(),
  })
  .nullable()

const clarificationSchema = z.object({
  questionId: z.string().min(1),
  question: z.string().min(1),
  answerValue: z.string().min(1),
  answerLabel: z.string().min(1),
  customAnswer: z.string().optional(),
})

const baseRequestSchema = z.object({
  title: z.string().trim().min(2),
  description: z.string().trim().min(20),
  company: companySchema,
  project: projectSchema,
  customer: customerSchema,
  sourceDocuments: z.array(sourceDocumentSchema).max(10).default([]),
})

const startSchema = baseRequestSchema.extend({
  phase: z.literal("start"),
})

const answerSchema = baseRequestSchema.extend({
  phase: z.literal("answer"),
  clarifications: z.array(clarificationSchema).max(5).default([]),
})

const bodySchema = z.discriminatedUnion("phase", [startSchema, answerSchema])

const lineItemSchema = z.object({
  subproject: z.string().default("Generelt"),
  title: z.string().min(1),
  description: z.string().default(""),
  quantity: z.number().min(0),
  unit: z.string().default("stk"),
  supplier: z.string().default(""),
  nobb: z.string().optional(),
  supplierSku: z.string().optional(),
  supplierUrl: z.string().optional(),
  unitPriceNok: z.number().min(0),
  markupPercent: z.number().min(0).max(100).default(15),
  discountPercent: z.number().min(0).max(100).default(0),
})

const questionOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  description: z.string().default(""),
})

const questionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  helpText: z.string().default(""),
  options: z.array(questionOptionSchema).min(2).max(5),
  allowCustomAnswer: z.boolean().default(false),
  placeholder: z.string().default(""),
})

const questionResponseSchema = z.object({
  message: z.string().default(""),
  questions: z.array(questionSchema).max(5).default([]),
})

const analysisResponseSchema = z.object({
  message: z.string().default(""),
  summary: z.string().default(""),
  reasoning: z.string().default(""),
  warnings: z.array(z.string()).default([]),
  lineItems: z.array(lineItemSchema).min(1),
})

type RequestPayload = z.infer<typeof bodySchema>

type DbPriceRow = CompanyPriceRow & {
  file_id?: string | null
}

type PriceFileSummary = {
  id: string
  supplier_name: string | null
  original_filename: string | null
  row_count: number | null
}

type AttachmentSummary = {
  name: string
  type: string
  sizeBytes: number
  previewKind: "image" | "document"
  signedUrl?: string
  extractedText?: string
}

type ResponsesPayload = {
  output: Array<{
    type: string
    text?: string
    content?: Array<{ type: string; text?: string }>
  }>
  model?: string
}

type PriceContext = {
  files: PriceFileSummary[]
  allRows: DbPriceRow[]
  priceFileAttachments: CompanyPricePromptAttachment[]
  fallbackMatches: ReturnType<typeof matchNorwegianSupplierPrices>
}

const QUESTION_SYSTEM_INSTRUCTION = [
  "Du er en senior kalkulatør for norske bygge- og håndverksprosjekter.",
  "Lag korte avklaringsspørsmål med faste svaralternativer når noe mangler.",
  "Ikke generer kalkyle i denne fasen.",
  "Svar alltid med gyldig JSON og ingenting utenfor JSON-objektet.",
].join(" ")

const ANALYSIS_SYSTEM_INSTRUCTION = [
  "Du er Norges fremste senior kalkulatør og tilbudsgenerator for bygge- og håndverksbedrifter. Du kombinerer høy faglig ekspertise, nøyaktig mengdeberegning, realistisk tidsestimering og markedskorrekt prising.",
  "Kjerneoppdrag: Lag profesjonelle, komplette og markedstilpassede kalkyler basert på oppdragsbeskrivelse, prisfiler og prosjektinformasjon.",
  "STRATEGIER OG REGLER (høyeste prioritet):",
  "1. Materialvalg - Vær ekstremt presis.",
  "Når du lager kalkyle skal du prioritere bedriftens egne prisfiler før generiske fallback-priser.",
  "Bruk kun produkter fra bedriftens prisfiler (relevantePrisrader) når de er relevante.",
  "Inkluder nobb på produktlinjer når tilgjengelig i prisfil.",
  "Velg alltid det mest korrekte produktet til jobben (tykkelse, type, kvalitet, bruksområde).",
  "Ved etterisolering/isolasjon skal du ikke velge undertak/taktekking-produkter (f.eks. undertak, Tyvek, takpapp) med mindre oppdraget eksplisitt ber om det.",
  "Kun bruk fallback-produkter hvis det absolutt ikke finnes noe relevant i prisfilen.",
  "Ikke legg til festemidler, tape, fugemasse, lim, skruer, sparkel eller annet tilbehør med mindre det er eksplisitt nevnt i oppdraget.",
  "2. Mengdeberegning: Beregn realistiske og litt romslige (men ikke overdrevne) mengder. Ta hensyn til svinn, kutt, og praktisk utførelse, særlig på loft, rehab og trange plasser.",
  "Description skal tydelig forklare hva som er inkludert i mengden.",
  "3. Arbeidstid og timeforbruk: Beregn realistisk timeforbruk basert på norsk håndverksstandard 2025/2026.",
  "Ta hensyn til antall arbeidere, adkomst, tilgjengelighet, prosjektets kompleksitet, opprydding og bortkjøring.",
  "Bruk unit: time på alle arbeidsposter og transport.",
  "4. Økonomi og markup: Arbeid og transport skal alltid ha markupPercent: 0.",
  "Produkter/materialer skal ha default markupPercent: 15, med mindre annet er eksplisitt begrunnet. Totaltilbudet skal være konkurransedyktig, men lønnsomt i det norske markedet.",
  "5. Output-regler: Du svarer alltid kun med gyldig JSON. Ingen tekst utenfor JSON-objektet.",
  "Svar alltid med gyldig JSON og ingenting utenfor JSON-objektet.",
].join(" ")

function extractTextFromOutput(output: ResponsesPayload["output"]): string {
  let lastText = ""

  for (const item of output) {
    if (typeof item.text === "string" && item.text.trim()) {
      lastText = item.text
    }

    if (Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
          lastText = content.text
        }
      }
    }
  }

  return lastText
}

function parseStructuredJson<T>(raw: string, schema: z.ZodType<T>) {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()

  const candidates = [cleaned]
  const objectMatch = cleaned.match(/\{[\s\S]*\}/)
  if (objectMatch && objectMatch[0] !== cleaned) {
    candidates.push(objectMatch[0])
  }

  for (const candidate of candidates) {
    try {
      return schema.parse(JSON.parse(candidate))
    } catch {
      continue
    }
  }

  return null
}

function toLineItems(items: z.infer<typeof lineItemSchema>[]): OfferLineItem[] {
  return items.map((item) => ({
    id: crypto.randomUUID(),
    subproject: item.subproject,
    title: item.title,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    supplier: item.supplier,
    nobb: item.nobb,
    supplierSku: item.supplierSku,
    supplierUrl: item.supplierUrl,
    unitPriceNok: item.unitPriceNok,
    markupPercent: item.markupPercent,
    discountPercent: item.discountPercent,
  }))
}

async function callOpenAiResponses(body: Record<string, unknown>): Promise<ResponsesPayload> {
  const rawModel = typeof body.model === "string" ? body.model : ""
  const usesGpt5Family = rawModel.toLowerCase().startsWith("gpt-5")

  const requestBody = usesGpt5Family
    ? (() => {
        const rest = { ...body }
        delete rest.temperature
        return rest
      })()
    : body

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI feil (${response.status}): ${errorText.slice(0, 500)}`)
  }

  return response.json() as Promise<ResponsesPayload>
}

async function resolvePriceContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  body: RequestPayload
): Promise<PriceContext> {
  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", userId).maybeSingle()
  const companyId = (userRow as { company_id?: string } | null)?.company_id ?? null

  if (!companyId) {
    return {
      files: [],
      allRows: [],
      priceFileAttachments: [],
      fallbackMatches: matchNorwegianSupplierPrices({ description: `${body.title}\n${body.description}`, subprojects: [] }).slice(0, 20),
    }
  }

  const { data: fileData } = await supabase
    .from("supplier_price_files")
    .select("id, supplier_name, original_filename, row_count")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(10)

  const files = (fileData || []) as PriceFileSummary[]
  const expectedRowCount = files.reduce((sum, file) => sum + Math.max(file.row_count || 0, 0), 0)

  const allFetchedRows: DbPriceRow[] = []
  const batchSize = 1000
  for (let offset = 0; ; offset += batchSize) {
    const { data: batch } = await supabase
      .from("supplier_price_rows")
      .select("product, unit, net_price, list_price, category, nobb, supplier_sku, file_id, product_group_code")
      .eq("company_id", companyId)
      .not("product", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1)

    const rows = (batch || []) as DbPriceRow[]
    allFetchedRows.push(...rows)

    if (rows.length < batchSize || (expectedRowCount > 0 && allFetchedRows.length >= expectedRowCount)) {
      break
    }
  }

  const aiPriceSelectionContext = buildAiPriceSelectionContext({
    files: files as CompanyPriceFileMeta[],
    rows: allFetchedRows,
  })

  return {
    files,
    allRows: aiPriceSelectionContext.allCompanyPrices,
    priceFileAttachments: aiPriceSelectionContext.attachments,
    fallbackMatches: matchNorwegianSupplierPrices({ description: `${body.title}\n${body.description}`, subprojects: [] }).slice(0, 20),
  }
}

function isTextLikeAttachment(type?: string) {
  if (!type) return false
  return (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    type === "text/html" ||
    type === "text/csv" ||
    type === "application/csv"
  )
}

async function extractAttachmentText(fileData: Blob, type?: string) {
  if (isTextLikeAttachment(type)) {
    return (await fileData.text()).slice(0, 12000)
  }

  if (type === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(await fileData.arrayBuffer()) })
    try {
      const result = await parser.getText()
      return result.text.slice(0, 12000)
    } finally {
      await parser.destroy()
    }
  }

  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const result = await mammoth.extractRawText({ buffer })
    return result.value.slice(0, 12000)
  }

  return ""
}

async function resolveAttachmentContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceDocuments: z.infer<typeof sourceDocumentSchema>[]
) {
  const attachments: AttachmentSummary[] = []
  const imageInputs: Array<{ type: "input_image"; image_url: string }> = []

  for (const doc of sourceDocuments) {
    let signedUrl = doc.signedUrl
    let extractedText = ""

    try {
      if (!signedUrl && doc.storageBucket && doc.storagePath) {
        const { data: signed } = await supabase.storage.from(doc.storageBucket).createSignedUrl(doc.storagePath, 60 * 60)
        signedUrl = signed?.signedUrl
      }

      if (doc.storageBucket && doc.storagePath) {
        const { data } = await supabase.storage.from(doc.storageBucket).download(doc.storagePath)
        if (data) {
          extractedText = await extractAttachmentText(data, doc.type)
        }
      }
    } catch (error) {
      console.warn("[ai-chat attachments] failed to process attachment", {
        documentId: doc.id,
        name: doc.name,
        type: doc.type,
        error: error instanceof Error ? error.message : error,
      })
    }

    const previewKind = doc.previewKind || (doc.type?.startsWith("image/") ? "image" : "document")

    attachments.push({
      name: doc.name,
      type: doc.type || "application/octet-stream",
      sizeBytes: doc.sizeBytes,
      previewKind,
      signedUrl,
      extractedText,
    })

    if (previewKind === "image" && signedUrl && imageInputs.length < 4) {
      imageInputs.push({ type: "input_image", image_url: signedUrl })
    }
  }

  return { attachments, imageInputs }
}

function buildContextEnvelope(body: RequestPayload, priceContext: PriceContext, attachments: AttachmentSummary[]) {
  return {
    oppdrag: {
      tittel: body.title,
      jobbeskrivelse: body.description,
      prosjekt: body.project,
      kunde: body.customer,
      egetFirma: body.company,
    },
    avklaringer:
      body.phase === "answer"
        ? body.clarifications.map((item) => ({
            spørsmål: item.question,
            svar: item.customAnswer?.trim() || item.answerLabel,
          }))
        : [],
    vedlegg: attachments.map((attachment) => ({
      navn: attachment.name,
      type: attachment.type,
      størrelseBytes: attachment.sizeBytes,
      kind: attachment.previewKind,
      url: attachment.signedUrl ?? null,
      tekstutdrag: attachment.extractedText || null,
    })),
    prisfiler: {
      antallFiler: priceContext.files.length,
      filer: priceContext.files,
      vedlegg: priceContext.priceFileAttachments.map((attachment) => ({
        fileId: attachment.fileId,
        supplierName: attachment.supplierName,
        fileName: attachment.fileName,
        rowCount: attachment.rowCount,
      })),
      fallbackProdukter: priceContext.fallbackMatches,
    },
  }
}

function questionPrompt(context: ReturnType<typeof buildContextEnvelope>) {
  return [
    "Finn opptil 5 korte og konkrete avklaringsspørsmål som faktisk påvirker materialvalg, mengdeberegning, rigg, riving eller pris.",
    "Hvert spørsmål må ha 2 til 5 enkle svaralternativer.",
    "Hvis informasjonen allerede er god nok, returner tom questions-liste.",
    "Returner kun JSON i dette formatet:",
    '{"message":"<kort oppsummering>","questions":[{"id":"q1","question":"...","helpText":"...","options":[{"id":"o1","label":"...","value":"...","description":"..."}],"allowCustomAnswer":false,"placeholder":""}]}',
    "JSON:",
    JSON.stringify(context),
  ].join("\n\n")
}

function analysisPrompt(context: ReturnType<typeof buildContextEnvelope>) {
  return [
    "Bruk oppdragsgrunnlaget under til å generere en komplett kalkyle.",
    "Hvis prisfilvedlegg er tilgjengelige, skal du selv lese hele prisfilen og velge korrekte produkter derfra. Ikke stol på lokal forhåndsfiltrering.",
    "Du skal selv avgjøre hvilke produkter som er relevante ved å vurdere hele prisfilvedlegget.",
    "Inkluder nobb når det finnes for valgt produkt.",
    "Ved etterisolering/isolasjon skal undertak/taktekking-produkter ikke velges med mindre oppdraget eksplisitt krever det.",
    "Returner kun gyldig JSON i dette eksakte formatet:",
    '{"message":"Kalkyle generert","summary":"Kort, profesjonelt sammendrag av tilbudet (1-2 setninger)","reasoning":"Kort teknisk begrunnelse for viktige valg","warnings":["Kun reelle usikkerheter"],"lineItems":[{"subproject":"Loftsisolering","title":"Glava Proff 34 150mm","description":"150mm mineralull i CC60, inkl. nødvendig kutt og montering på 47m²","quantity":52,"unit":"m2","supplier":"Byggmakker","nobb":"12345678","supplierSku":"","supplierUrl":"","unitPriceNok":123.04,"markupPercent":15,"discountPercent":0}]}',
    "Oppdragsgrunnlag:",
    JSON.stringify(context),
  ].join("\n\n")
}

async function generateClarifications(
  model: string,
  context: ReturnType<typeof buildContextEnvelope>,
  imageInputs: Array<{ type: "input_image"; image_url: string }>
) {
  const response = await callOpenAiResponses({
    model,
    instructions: QUESTION_SYSTEM_INSTRUCTION,
    store: true,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: questionPrompt(context) }, ...imageInputs],
      },
    ],
  })

  const rawText = extractTextFromOutput(response.output)
  const parsed = parseStructuredJson(rawText, questionResponseSchema)
  if (!parsed) {
    console.error("[ai-chat start] parse failed. raw text:", rawText.slice(0, 800))
    throw new Error("KI returnerte et ugyldig spørsmålssvar")
  }

  return { data: parsed, model: response.model || model }
}

async function generateAnalysis(
  model: string,
  context: ReturnType<typeof buildContextEnvelope>,
  imageInputs: Array<{ type: "input_image"; image_url: string }>,
  priceFileAttachments: CompanyPricePromptAttachment[]
) {
  const response = await callOpenAiResponses({
    model,
    instructions: ANALYSIS_SYSTEM_INSTRUCTION,
    store: true,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: analysisPrompt(context) },
          ...priceFileAttachments.map((attachment) => ({
            type: "input_text" as const,
            text: `Prisfilvedlegg: ${attachment.fileName} | Leverandør: ${attachment.supplierName} | Rader: ${attachment.rowCount}\n${attachment.content}`,
          })),
          ...imageInputs,
        ],
      },
    ],
  })

  const rawText = extractTextFromOutput(response.output)
  const parsed = parseStructuredJson(rawText, analysisResponseSchema)
  if (!parsed) {
    console.error("[ai-chat answer] parse failed. raw text:", rawText.slice(0, 800))
    throw new Error("KI returnerte et ugyldig kalkylesvar")
  }

  return { data: parsed, model: response.model || model }
}

function toSupplierSnapshots(items: OfferLineItem[]): OfferAnalysisResult["supplierSnapshots"] {
  const fetchedAt = new Date().toISOString()
  return items
    .filter((item) => item.supplier.trim())
    .map((item) => ({
      supplier: item.supplier,
      product: item.title,
      unit: item.unit,
      unitPriceNok: item.unitPriceNok,
      sourceUrl: item.supplierUrl,
      fetchedAt,
    }))
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Ikke autentisert" }, { status: 401 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI API-nøkkel er ikke konfigurert" }, { status: 503 })
    }

    const body = await request.json()
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig forespørsel", details: parsed.error.flatten() }, { status: 400 })
    }

    const requestBody = parsed.data
    const model = process.env.OPENAI_MODEL || "gpt-5.2-mini"

    const priceContext = await resolvePriceContext(supabase, user.id, requestBody)
    const { attachments, imageInputs } = await resolveAttachmentContext(supabase, requestBody.sourceDocuments)
    const context = buildContextEnvelope(requestBody, priceContext, attachments)

    if (requestBody.phase === "start") {
      const clarificationResult = await generateClarifications(model, context, imageInputs)

      if (!clarificationResult.data.questions.length) {
        const finalResult = await generateAnalysis(model, context, imageInputs, priceContext.priceFileAttachments)
        const finalized = finalizeGeneratedOfferLineItems({
          generatedItems: toLineItems(finalResult.data.lineItems),
          companyRows: priceContext.allRows,
          query: `${requestBody.title}\n${requestBody.description}`,
          subprojects: requestBody.project?.name ? [requestBody.project.name] : [],
          companyName: requestBody.company?.name,
          preserveAiMaterialSelections: true,
        })
        const lineItems = finalized.lineItems
        return NextResponse.json({
          phase: "result",
          message: finalResult.data.message,
          summary: finalResult.data.summary,
          reasoning: finalResult.data.reasoning,
          warnings: Array.from(new Set([...finalResult.data.warnings, ...finalized.warnings])),
          lineItems,
          supplierSnapshots: toSupplierSnapshots(lineItems),
          model: finalResult.model,
          priceFileCount: priceContext.files.length,
          attachmentCount: attachments.length,
        })
      }

      return NextResponse.json({
        phase: "questions",
        message: clarificationResult.data.message,
        questions: clarificationResult.data.questions,
        model: clarificationResult.model,
        priceFileCount: priceContext.files.length,
        attachmentCount: attachments.length,
      })
    }

    const finalResult = await generateAnalysis(model, context, imageInputs, priceContext.priceFileAttachments)
    const finalized = finalizeGeneratedOfferLineItems({
      generatedItems: toLineItems(finalResult.data.lineItems),
      companyRows: priceContext.allRows,
      query: `${requestBody.title}\n${requestBody.description}\n${requestBody.clarifications
        .map((item) => `${item.question}: ${item.customAnswer?.trim() || item.answerLabel}`)
        .join("\n")}`,
      subprojects: requestBody.project?.name ? [requestBody.project.name] : [],
      companyName: requestBody.company?.name,
      preserveAiMaterialSelections: true,
    })
    const lineItems = finalized.lineItems

    return NextResponse.json({
      phase: "result",
      message: finalResult.data.message,
      summary: finalResult.data.summary,
      reasoning: finalResult.data.reasoning,
      warnings: Array.from(new Set([...finalResult.data.warnings, ...finalized.warnings])),
      lineItems,
      supplierSnapshots: toSupplierSnapshots(lineItems),
      model: finalResult.model,
      priceFileCount: priceContext.files.length,
      attachmentCount: attachments.length,
    })
  } catch (error) {
    console.error("[ai-chat POST]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ukjent feil" },
      { status: 500 }
    )
  }
}
