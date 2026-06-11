#!/usr/bin/env node
/**
 * Verifiser Tripletex test/prod-oppsett i .env.local
 * Kjør: node scripts/verify-tripletex-env.mjs
 */
import { readFileSync } from "fs"
import { resolve } from "path"

const envPath = resolve(process.cwd(), ".env.local")

for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, "")
  }
}

const baseUrl = process.env.TRIPLETEX_BASE_URL || "https://tripletex.no/v2"
const consumer = process.env.TRIPLETEX_CONSUMER_TOKEN || ""
const applicationName = process.env.TRIPLETEX_APPLICATION_NAME || ""
const isTest = baseUrl.includes("api-test.tripletex.tech")

console.log("Tripletex miljø:", isTest ? "TEST" : "PROD")
console.log("Base URL:", baseUrl)
console.log("Applikasjonsnavn:", applicationName || "(mangler)")

if (!consumer) {
  console.error("\n❌ TRIPLETEX_CONSUMER_TOKEN mangler.")
  if (isTest) {
    console.error("   Hent fra e-post etter test-registrering: https://developer.tripletex.no")
  }
  process.exit(1)
}

function decodeWrapped(value) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"))
    return typeof parsed?.token === "string" ? parsed.token : null
  } catch {
    return null
  }
}

const inner = decodeWrapped(consumer)
console.log("Consumer tokenId:", inner ? JSON.parse(Buffer.from(consumer, "base64").toString("utf8")).tokenId : "ukjent")
console.log("Consumer er test-token:", inner?.startsWith("test-") ? "ja" : "nei")

if (isTest && inner && !inner.startsWith("test-")) {
  console.warn("\n⚠️  Du bruker test-URL men produksjons-consumer-token.")
}

if (!isTest && inner?.startsWith("test-")) {
  console.warn("\n⚠️  Du bruker prod-URL men test-consumer-token.")
}

const expirationDate = new Date()
expirationDate.setDate(expirationDate.getDate() + 7)
const params = new URLSearchParams({
  consumerToken: consumer,
  employeeToken: process.argv[2] || "00000000-0000-0000-0000-000000000000",
  expirationDate: expirationDate.toISOString().slice(0, 10),
})

const response = await fetch(`${baseUrl}/token/session/:create?${params}`, {
  method: "PUT",
  headers: { Accept: "application/json" },
})

const body = await response.json().catch(() => ({}))
const validation = (body.validationMessages || []).map((v) => `${v.field}: ${v.message}`).join(" | ")

if (response.ok) {
  console.log("\n✅ Consumer token er gyldig (session opprettet).")
  process.exit(0)
}

if (validation.includes("consumerToken")) {
  console.error("\n❌ Consumer token er ugyldig for dette miljøet.")
  console.error("   ", validation)
  process.exit(1)
}

if (validation.includes("employeeToken")) {
  console.log("\n✅ Consumer token er gyldig for dette miljøet.")
  console.log("   (Employee/API-nøkkel må testes separat i UI.)")
  process.exit(0)
}

console.error("\n❌ Uventet svar:", response.status, validation || body.message || body)
process.exit(1)
