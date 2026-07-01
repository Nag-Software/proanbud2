import "server-only"

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

import chromium from "@sparticuz/chromium"
import puppeteer from "puppeteer-core"

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

let cachedFontFaceCss: string | null = null

/**
 * Satoshi (the app font) embedded as a base64 @font-face so the generated PDF
 * matches the in-app document exactly — the serverless Chromium has no Satoshi
 * (nor Arial) installed. Falls back to an empty string (system sans-serif)
 * when the font file is unavailable.
 */
export async function getOfferPdfFontCss() {
  if (cachedFontFaceCss !== null) return cachedFontFaceCss

  try {
    const fontPath = path.join(
      process.cwd(),
      "lib/fonts/Satoshi_Complete/Fonts/WEB/fonts/Satoshi-Variable.woff2"
    )
    const base64 = (await readFile(fontPath)).toString("base64")
    cachedFontFaceCss = `@font-face { font-family: "Satoshi"; src: url(data:font/woff2;base64,${base64}) format("woff2"); font-weight: 300 900; font-style: normal; font-display: block; }`
  } catch {
    cachedFontFaceCss = ""
  }

  return cachedFontFaceCss
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

/**
 * Render a self-contained offer HTML page (from `buildOfferDocumentPage`) to an
 * A4 PDF. The bottom margin carries a repeating footer: the company line
 * (centered) and page numbers (right) — so build the page with
 * `printMarginMode: "external"`, which hides the in-content footer strip.
 */
export async function renderOfferPdf(html: string, options: { footerText?: string } = {}) {
  const footerText = options.footerText?.trim() || ""
  const footerTemplate = `
    <div style="width:100%;position:relative;padding:0 12.7mm;font-size:8px;color:#9ca3af;font-family:Arial,sans-serif;text-align:center;">
      <span>${escapeHtml(footerText)}</span>
      <span style="position:absolute;right:12.7mm;top:0;">Side <span class="pageNumber"></span> av <span class="totalPages"></span></span>
    </div>`

  let browser
  try {
    browser = await launchBrowser()
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: "load", timeout: 30000 })
    // Base64 fonts decode asynchronously — wait so text doesn't fall back.
    await page.evaluateHandle("document.fonts.ready")
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate,
      margin: { top: "8mm", bottom: "16mm", left: "0", right: "0" },
    })
    return pdf
  } finally {
    if (browser) await browser.close()
  }
}
