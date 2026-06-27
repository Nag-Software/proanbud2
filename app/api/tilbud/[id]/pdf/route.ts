import { existsSync } from "node:fs"

import chromium from "@sparticuz/chromium"
import puppeteer from "puppeteer-core"

import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"
import { fetchOfferCompanyContext } from "@/lib/tilbud/company-profile"
import { readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary"
import {
  buildOfferDocumentPage,
  formatOfferReference,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { type OfferLineItem } from "@/lib/tilbud/types"

export const runtime = "nodejs"
export const maxDuration = 60

type CustomerRow = {
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  org_number: string | null
}

type ProjectRow = { name: string | null; customers?: CustomerRow | CustomerRow[] | null }

type OfferRow = {
  id: string
  title: string | null
  description: string | null
  created_at: string | null
  quote_valid_until: string | null
  source_summary: string | null
  analysis_result: unknown
  line_items: unknown
  customers?: CustomerRow | CustomerRow[] | null
  projects?: ProjectRow | ProjectRow[] | null
}

function normalizeRelatedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function normalizeLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) return []
  return input
    .map((row) => {
      const item = row as Partial<OfferLineItem>
      return {
        id: String(item.id || crypto.randomUUID()),
        subproject: String(item.subproject || "Generelt"),
        title: String(item.title || ""),
        description: String(item.description || ""),
        quantity: Number(item.quantity || 0),
        unit: String(item.unit || "stk"),
        supplier: String(item.supplier || ""),
        nobb: item.nobb ? String(item.nobb) : undefined,
        supplierSku: item.supplierSku ? String(item.supplierSku) : undefined,
        supplierUrl: item.supplierUrl ? String(item.supplierUrl) : undefined,
        unitPriceNok: Number(item.unitPriceNok || 0),
        markupPercent: Number(item.markupPercent || 0),
        discountPercent: Number(item.discountPercent || 0),
      }
    })
    .filter((item) => item.title.trim().length > 0)
}

// Common local Chrome/Chromium install locations, used as a fallback during dev
// so the bundled (Linux-only) @sparticuz/chromium binary isn't spawned on macOS/
// Windows — which fails with ENOEXEC.
const LOCAL_CHROME_PATHS = [
  // macOS
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  // Windows
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
]

function findLocalChrome() {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  if (fromEnv) return fromEnv
  return LOCAL_CHROME_PATHS.find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Launch Chromium. On serverless (Vercel) the bundled @sparticuz/chromium binary
 * is used. Locally we use a real Chrome/Chromium install — either from
 * PUPPETEER_EXECUTABLE_PATH or auto-detected — so dev works without the
 * serverless binary (which is Linux-only and fails with ENOEXEC elsewhere).
 */
async function launchBrowser() {
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)
  if (!isServerless) {
    const localExecutable = findLocalChrome()
    if (localExecutable) {
      return puppeteer.launch({
        executablePath: localExecutable,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })
    }
  }
  return puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: true,
  })
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const company = await fetchOfferCompanyContext(supabase, user.id)
  if (!company) return new Response("Ingen bedrift", { status: 404 })

  const { data: offerData } = await supabase
    .from("offers")
    .select(
      "id, title, description, created_at, quote_valid_until, source_summary, analysis_result, line_items, customers(name, email, phone, address, postal_code, city, org_number), projects(name, customers(name, email, phone, address, postal_code, city, org_number))"
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle()

  if (!offerData) return new Response("Tilbud ikke funnet", { status: 404 })

  const offer = offerData as OfferRow
  const project = normalizeRelatedRow(offer.projects)
  const customer = normalizeRelatedRow(offer.customers) || normalizeRelatedRow(project?.customers)

  const documentData: OfferDocumentData = {
    title: offer.title || "Tilbud",
    description: offer.description || "",
    projectSummary: readProjectSummaryFromAnalysis(offer.analysis_result),
    quoteMessage: offer.source_summary || "",
    projectName: project?.name || "",
    customer: {
      name: customer?.name || "Kunde",
      email: customer?.email,
      phone: customer?.phone,
      address: customer?.address,
      city: customer?.city,
      orgNumber: customer?.org_number,
    },
    lineItems: normalizeLineItems(offer.line_items),
    company,
    issuedDate: offer.created_at,
    quoteValidUntil: offer.quote_valid_until,
  }

  // Only show the logo when it is an absolute URL — a relative favicon fallback
  // would render as a broken image in the headless browser.
  const showLogo = Boolean(company.logoUrl && /^https?:\/\//.test(company.logoUrl))
  const html = buildOfferDocumentPage(documentData, { autoPrint: false, showLogo })

  let browser
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "load", timeout: 30000 })
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true })
    const filename = `Tilbud-${formatOfferReference(offer.id)}.pdf`
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[tilbud pdf] generering feilet", error)
    await logServerError({
      message: "Offer PDF generation failed",
      error,
      source: "api",
      route: "GET /api/tilbud/[id]/pdf",
      statusCode: 500,
      companyId: company.id,
      userId: user.id,
      context: { offerId: id },
    })
    return new Response("Kunne ikke generere PDF", { status: 500 })
  } finally {
    if (browser) await browser.close()
  }
}
