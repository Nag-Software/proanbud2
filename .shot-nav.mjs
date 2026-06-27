import puppeteer from "puppeteer-core"
import { existsSync } from "node:fs"

const BASE = "http://localhost:3000"
const OUT = "/private/tmp/claude-501/-Users-casper-Desktop-Nag-Software-proanbud2/a117ae47-fd1b-4bd6-94de-d438ae149a94/scratchpad"
const GO = `${OUT}/GO3`
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PROFILE = `${OUT}/chrome-profile` // persisted → log in once, reused next runs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  args: ["--window-size=440,920"],
})
const page = (await browser.pages())[0] ?? (await browser.newPage())
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

// If the persisted profile is already logged in, skip the wait.
await page.goto(`${BASE}/min-bedrift/kjorebok`, { waitUntil: "networkidle2" }).catch(() => {})
await sleep(1500)
if (page.url().includes("/login")) {
  console.log("\n>>> Not logged in. Log in in the window, then say GO. Waiting...\n")
  while (!existsSync(GO)) { await sleep(1000) }
  console.log(">>> GO received.")
  await page.goto(`${BASE}/min-bedrift/kjorebok`, { waitUntil: "networkidle2" }).catch(() => {})
  await sleep(1500)
} else {
  console.log(">>> Already logged in (persisted profile).")
}

// Overview — nav over a content page
await page.screenshot({ path: `${OUT}/nav-overview.png` })
console.log("shot: overview")

// Dashboard — nav over a busier page
await page.goto(`${BASE}/`, { waitUntil: "networkidle2" }).catch(() => {})
await sleep(2000)
await page.screenshot({ path: `${OUT}/nav-dashboard.png` })
console.log("shot: dashboard")

await browser.close()
console.log("DONE")
