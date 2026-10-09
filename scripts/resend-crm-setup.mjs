// Engangsoppsett av Resend for lib/resend-crm/: kontaktfelt, segmenter og
// event-definisjoner. Idempotent — kjør på nytt så mye du vil; det som finnes
// fra før, hoppes over.
//
//   node --env-file=.env.local scripts/resend-crm-setup.mjs
//
// Navnene her MÅ matche lib/resend-crm/model.ts.

const KEY = process.env.RESEND_API_KEY?.trim()
if (!KEY) {
  console.error("RESEND_API_KEY mangler")
  process.exit(1)
}

const PROPERTIES = [
  { key: "firmanavn", type: "string", fallback_value: "firmaet ditt" },
  { key: "fag", type: "string", fallback_value: "" },
  { key: "plan", type: "string", fallback_value: "" },
  { key: "status", type: "string", fallback_value: "" },
  { key: "proeve_slutt", type: "string", fallback_value: "" },
  { key: "antall_tilbud", type: "number", fallback_value: 0 },
  { key: "sum_tilbud", type: "number", fallback_value: 0 },
  { key: "rabattkode", type: "string", fallback_value: "" },
]

const SEGMENTS = ["Alle prøvebrukere", "I prøveperiode", "Utløpt prøve", "Betalende", "Avsluttet"]

const EVENT_SCHEMA = { fornavn: "string", firmanavn: "string", plan: "string", antall_tilbud: "number" }
const EVENTS = [
  "proeve.startet",
  "tilbud.forste_sendt",
  "proeve.utlopt",
  "abonnement.betalt",
  "abonnement.avsluttet",
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, path, body) {
  await sleep(600) // holder oss under standard rate limit
  const res = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  return json
}

const names = (list, field) => new Set((list?.data ?? []).map((x) => x[field]))

const existingProps = names(await api("GET", "/contact-properties?limit=100"), "key")
for (const p of PROPERTIES) {
  if (existingProps.has(p.key)) {
    console.log(`felt     ${p.key} finnes`)
    continue
  }
  await api("POST", "/contact-properties", p)
  console.log(`felt     ${p.key} opprettet`)
}

const existingSegments = names(await api("GET", "/segments?limit=100"), "name")
for (const name of SEGMENTS) {
  if (existingSegments.has(name)) {
    console.log(`segment  ${name} finnes`)
    continue
  }
  await api("POST", "/segments", { name })
  console.log(`segment  ${name} opprettet`)
}

const existingEvents = names(await api("GET", "/events?limit=100"), "name")
for (const name of EVENTS) {
  if (existingEvents.has(name)) {
    console.log(`event    ${name} finnes`)
    continue
  }
  await api("POST", "/events", { name, schema: EVENT_SCHEMA })
  console.log(`event    ${name} opprettet`)
}

console.log("\nFerdig. Sett RESEND_CRM=on i Vercel og kjør backfill (se docs/resend-crm.md).")
