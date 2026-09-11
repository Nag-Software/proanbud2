// Portene: harde, deterministiske sjekker som avgjør om et firma i det hele
// tatt kan få kald e-post. Kjøres før noen KI-kostnad og igjen rett før hver
// sending — lovligheten ligger i koden, ikke i en prompt.
//
// Markedsføringsloven § 15: kald e-post til fysiske personer krever samtykke.
// Derfor:
//   • ENK (enkeltpersonforetak) er innehaveren selv → aldri kald e-post.
//   • NUF er utenlandske foretak → utenfor målgruppen.
//   • Adresser som tilhører en navngitt person (ola.nordmann@…, roy@firma.no,
//     daglig leders navn) → aldri kald e-post, kun telefon.
//   • Generelle firmaadresser (post@, kontakt@ … på firmaets domene) → OK.
//   • Gmail o.l. der delen før @ tydelig er firmanavnet (timrebygg@gmail.com)
//     → OK for AS (Caspers beslutning 2026-09-11).

import { getSegment } from "@/lib/outreach/segments"

// ── E-postadresser ──────────────────────────────────────────────────────────

export const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.no",
  "outlook.com",
  "outlook.no",
  "live.com",
  "live.no",
  "msn.com",
  "yahoo.com",
  "yahoo.no",
  "icloud.com",
  "me.com",
  "mac.com",
  "online.no",
  "frisurf.no",
  "broadpark.no",
  "c2i.net",
  "getmail.no",
  "start.no",
  "lyse.net",
  "altibox.no",
  "hotmail.co.uk",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "inbox.lt",
  "mail.com",
  "gmx.com",
  "gmx.net",
])

/** Lokaldeler som er en funksjon, ikke en person. */
export const ROLE_LOCALPARTS = new Set([
  "post",
  "postmottak",
  "firmapost",
  "kontakt",
  "kontor",
  "info",
  "mail",
  "epost",
  "firma",
  "tilbud",
  "ordre",
  "bestilling",
  "service",
  "salg",
  "admin",
  "administrasjon",
  "booking",
  "hei",
  "resepsjon",
  "sentralbord",
  "office",
  "contact",
  "sales",
  "support",
  "prosjekt",
  "faktura",
  "regnskap",
  "okonomi",
  "jobb",
])

/** Lokaldeler vi aldri skriver til (systemadresser). */
const BLOCKED_LOCALPARTS = new Set([
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "postmaster",
  "abuse",
  "mailer-daemon",
  "hostmaster",
  "webmaster",
])

/** Ord som ikke skiller ett firma fra et annet («bygg», «service» …). */
const GENERIC_NAME_TOKENS = new Set([
  "bygg",
  "byggservice",
  "byggmester",
  "service",
  "entreprenor",
  "entreprenorer",
  "tomrer",
  "tomrerservice",
  "maler",
  "malerfirma",
  "malermester",
  "elektro",
  "elektriker",
  "ror",
  "rorlegger",
  "vvs",
  "tak",
  "montasje",
  "handverk",
  "handverker",
  "snekker",
  "hus",
  "hytte",
  "hytter",
  "eiendom",
  "prosjekt",
  "gruppen",
  "group",
  "norge",
  "norway",
  "holding",
  "design",
  "anlegg",
  "multiservice",
  "boligservice",
  "mur",
  "murer",
  "gulv",
  "totalentreprise",
])

/** Vanlige fornavn i Norge (normalisert, uten æøå) — fanger «kasperjohansen@»
 *  og «roy@» der Brreg-rollene ikke nevner personen (ansatte på /om-oss). */
const COMMON_FIRST_NAMES = new Set([
  "adrian", "alexander", "anders", "andre", "andreas", "anne", "arne", "arild", "arvid", "asbjorn",
  "aleksander", "atle", "audun", "bjorn", "bjarne", "bard", "bent", "bernt", "birger", "christian",
  "christoffer", "dag", "daniel", "david", "egil", "einar", "eirik", "eivind", "elias", "emil",
  "endre", "erik", "erlend", "espen", "even", "fredrik", "frode", "geir", "gunnar", "gustav",
  "haakon", "hakon", "hans", "harald", "helge", "henrik", "henning", "helene", "hilde", "ida",
  "ingrid", "ivar", "jakob", "jan", "jarle", "jens", "joachim", "johan", "johannes", "johnny",
  "jon", "jonas", "jorgen", "jostein", "karl", "kasper", "kenneth", "kim", "kjell", "kjetil",
  "knut", "kristian", "kristoffer", "lars", "leif", "lene", "lise", "magnus", "marius", "markus",
  "martin", "mathias", "mats", "mikael", "mona", "morten", "nils", "odd", "olav", "ole",
  "oskar", "ove", "oyvind", "paal", "pal", "per", "petter", "preben", "rolf", "roger",
  "ronny", "rune", "roy", "ruben", "sander", "sebastian", "sigurd", "simen", "sindre", "sivert",
  "stein", "steinar", "stian", "sven", "svein", "sverre", "terje", "thomas", "tobias", "tom",
  "tommy", "tor", "tore", "torbjorn", "torgeir", "trond", "trygve", "vegard", "vidar", "william",
  "anna", "astrid", "camilla", "caroline", "elisabeth", "emma", "hanne", "heidi", "ingvild", "julie",
  "kari", "karin", "kristin", "linda", "maria", "marianne", "marte", "nina", "nora", "randi",
  "silje", "siri", "sofie", "stine", "tone", "tonje", "trine", "tuva", "vilde",
])

const STOP_TOKENS = new Set(["og", "i", "pa", "av", "the", "and", "med", "for", "til"])
const LEGAL_SUFFIX_TOKENS = new Set(["as", "asa", "ans", "da", "enk", "nuf", "sa", "ba", "ks", "sp", "z", "o"])

/** Små bokstaver, æøå → ae/o/a, fjern alt som ikke er a–z/0–9. */
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/[øö]/g, "o")
    .replace(/[åä]/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

/** Firmanavnets ord, uten selskapsform og småord. */
export function companyNameTokens(companyName: string): string[] {
  return companyName
    .split(/[\s&.,/()\-–+]+/)
    .map(normalizeForMatch)
    .filter((token) => token.length >= 2 && !STOP_TOKENS.has(token) && !LEGAL_SUFFIX_TOKENS.has(token))
}

/** Personnavn fra Brreg-roller → ord på minst 3 tegn (fornavn, mellomnavn, etternavn). */
export function personNameTokens(names: string[]): string[] {
  const tokens = new Set<string>()
  for (const name of names) {
    for (const part of name.split(/[\s\-]+/)) {
      const token = normalizeForMatch(part)
      if (token.length >= 3) tokens.add(token)
    }
  }
  return [...tokens]
}

function distinctiveTokens(tokens: string[]): string[] {
  return tokens.filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token))
}

/** Inneholder teksten firmanavnet? Ett særpreget ord holder («timre» i
 *  «timrebygg»); består navnet bare av generiske ord, må minst to av dem være med. */
function matchesCompanyName(haystack: string, tokens: string[]): boolean {
  if (!haystack) return false
  const distinctive = distinctiveTokens(tokens)
  if (distinctive.length > 0) return distinctive.some((token) => haystack.includes(token))
  const generic = tokens.filter((token) => token.length >= 3)
  return generic.length >= 2 && generic.filter((token) => haystack.includes(token)).length >= 2
}

/**
 * Er lokaldelen en persons navn? Vi tar bort navnene fra Brreg-rollene og ser
 * på det som er igjen:
 *  • ingenting igjen («johansen», «kristianfuglevik») → person
 *  • bare firma-/fagord igjen («lunnbygg» for Lunn Bygg AS, «tomrersveum») → firma
 *  • noe annet igjen («hjajohansen» — et forkortet fornavn) → person
 */
function containsPersonName(localNorm: string, personTokens: string[], companyTokens: string[]): boolean {
  const hits = personTokens.filter((token) => localNorm.includes(token)).sort((a, b) => b.length - a.length)
  if (hits.length === 0) return false

  let rest = localNorm
  for (const token of hits) rest = rest.split(token).join("")
  if (!rest) return true

  const known = [
    ...companyTokens.filter((token) => token.length >= 3 && !personTokens.includes(token)),
    ...GENERIC_NAME_TOKENS,
  ].sort((a, b) => b.length - a.length)
  for (const token of known) rest = rest.split(token).join("")
  return rest.length > 1
}

/** Lokaldelen delt på . _ - — «erik.stolpe» → ["erik","stolpe"]. */
function localParts(local: string): string[] {
  return local
    .replace(/\d+$/, "")
    .split(/[._-]+/)
    .map(normalizeForMatch)
    .filter(Boolean)
}

export type EmailClass =
  | "generisk_firmadomene"
  | "firmanavn_freemail"
  | "personnavn"
  | "ukjent"
  | "ugyldig"

export const SENDABLE_EMAIL_CLASSES: ReadonlySet<EmailClass> = new Set([
  "generisk_firmadomene",
  "firmanavn_freemail",
])

export const EMAIL_CLASS_LABELS: Record<EmailClass, string> = {
  generisk_firmadomene: "Generell firmaadresse",
  firmanavn_freemail: "Firmanavn på Gmail o.l.",
  personnavn: "Personlig adresse",
  ukjent: "Ukjent eier",
  ugyldig: "Ugyldig adresse",
}

export type ClassifyEmailInput = {
  companyName: string
  /** Firmaets eget domene (fra nettsiden), hvis kjent. */
  companyDomain?: string | null
  /** Navn på personer i Brreg-rollene (daglig leder, styre, innehaver). */
  personNames?: string[]
}

export function emailDomainOf(email: string): string | null {
  const at = email.lastIndexOf("@")
  if (at <= 0) return null
  return email.slice(at + 1).trim().toLowerCase() || null
}

/** Registrerbart domene fra en nettadresse: «https://www.firma.no/x» → «firma.no». */
export function domainFromWebsite(website: string | null | undefined): string | null {
  if (!website?.trim()) return null
  try {
    const url = new URL(website.startsWith("http") ? website : `https://${website}`)
    return url.hostname.replace(/^www\./, "").toLowerCase() || null
  } catch {
    return null
  }
}

function sameSite(a: string, b: string): boolean {
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/**
 * Hvem eier adressen? Bare de to første klassene kan få kald e-post.
 *
 * Reglene (i rekkefølge):
 *  1. Systemadresser og ugyldig syntaks → ugyldig.
 *  2. Personnavn i lokaldelen (fra Brreg-rollene, eller «a.b»-mønster med
 *     initial) → personnavn — også når etternavnet er firmanavnet (e.lunn@).
 *  3. Firmadomene: rollelokaldel eller firmanavnet → generisk; alt annet er en
 *     navngitt ansatt → personnavn.
 *  4. Freemail: firmanavnet i lokaldelen → firmanavn_freemail; «fornavn.etternavn»
 *     → personnavn; ellers ukjent.
 *  5. Et tredjepartsdomene (verken freemail eller firmaets) → ukjent.
 */
export function classifyContactEmail(email: string, input: ClassifyEmailInput): EmailClass {
  const trimmed = email.trim().toLowerCase()
  const match = /^([^@\s]+)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(trimmed)
  if (!match) return "ugyldig"
  const [, local, domain] = match
  if (BLOCKED_LOCALPARTS.has(local)) return "ugyldig"

  const companyTokens = companyNameTokens(input.companyName)
  const personTokens = personNameTokens(input.personNames ?? [])
  const localNorm = normalizeForMatch(local.replace(/\d+$/, ""))
  const parts = localParts(local)
  const baseLocal = normalizeForMatch(local.replace(/\d+$/, ""))

  // 2) Personnavn slår alt: en rolleperson i lokaldelen, eller initial + navn.
  const initialPlusSurname = personTokens.some(
    (token) => localNorm.length === token.length + 1 && localNorm.endsWith(token),
  )
  const initialPlusName = parts.length >= 2 && parts.some((part) => part.length === 1)
  if (initialPlusSurname || initialPlusName || containsPersonName(localNorm, personTokens, companyTokens)) {
    return "personnavn"
  }

  const isFreemail = FREEMAIL_DOMAINS.has(domain)
  const companyDomain = input.companyDomain?.toLowerCase().replace(/^www\./, "") || null
  const domainLabel = normalizeForMatch(domain.split(".").slice(0, -1).join(""))
  const isCompanyDomain =
    !isFreemail &&
    (companyDomain ? sameSite(domain, companyDomain) : matchesCompanyName(domainLabel, companyTokens))

  // «kasperjohansen», «roybygg», «ole» — et vanlig fornavn først, og resten er
  // tomt, et etternavn/firmaord eller et generisk fagord. Da er det en person,
  // selv når etternavnet også står i firmanavnet (Johansen Bygg AS).
  const startsWithFirstName = [...COMMON_FIRST_NAMES].some((name) => {
    if (!localNorm.startsWith(name)) return false
    const rest = localNorm.slice(name.length)
    return rest === "" || companyTokens.includes(rest) || GENERIC_NAME_TOKENS.has(rest) || personTokens.includes(rest)
  })
  if (startsWithFirstName && !ROLE_LOCALPARTS.has(baseLocal)) return "personnavn"

  const looksLikePerson =
    parts.length >= 2 && parts.every((part) => /^[a-z]+$/.test(part)) &&
    (parts.some((part) => COMMON_FIRST_NAMES.has(part)) ||
      !parts.some((part) => companyTokens.includes(part) || ROLE_LOCALPARTS.has(part)))

  // 3) Firmaets eget domene.
  if (isCompanyDomain) {
    if (ROLE_LOCALPARTS.has(baseLocal)) return "generisk_firmadomene"
    if (!looksLikePerson && matchesCompanyName(localNorm, companyTokens)) return "generisk_firmadomene"
    return "personnavn"
  }

  // 4) Gmail, Hotmail o.l.
  if (isFreemail) {
    if (looksLikePerson) return "personnavn"
    if (matchesCompanyName(localNorm, companyTokens)) return "firmanavn_freemail"
    return "ukjent"
  }

  // 5) Tredjepartsdomene — vi kan ikke vite hvem som eier det.
  return looksLikePerson ? "personnavn" : "ukjent"
}

// ── Firmaporter ─────────────────────────────────────────────────────────────

export type GateReason =
  | "orgform_enk"
  | "orgform_nuf"
  | "orgform_annen"
  | "orgform_ukjent"
  | "konkurs"
  | "ansatte_utenfor"
  | "eksisterende_kunde"
  | "avmeldt"
  | "ingen_epost"
  | "epost_personnavn"
  | "epost_ukjent"
  | "epost_ugyldig"

export const GATE_REASON_LABELS: Record<GateReason, string> = {
  orgform_enk: "Enkeltpersonforetak — innehaveren er en privatperson (mfl. § 15)",
  orgform_nuf: "Utenlandsk foretak (NUF)",
  orgform_annen: "Organisasjonsformen er utenfor målgruppen",
  orgform_ukjent: "Ukjent organisasjonsform — sjekk mot Brønnøysund først",
  konkurs: "Konkurs eller under avvikling",
  ansatte_utenfor: "Antall ansatte er utenfor målgruppen",
  eksisterende_kunde: "Er allerede kunde",
  avmeldt: "Har meldt seg av eller returnert e-post",
  ingen_epost: "Mangler e-postadresse",
  epost_personnavn: "Adressen tilhører en person — bruk telefon (mfl. § 15)",
  epost_ukjent: "Kan ikke se at adressen tilhører firmaet — bruk telefon",
  epost_ugyldig: "Ugyldig e-postadresse",
}

/** Porter som gjør at firmaet ikke kan kontaktes i det hele tatt. Epost-grunner
 *  betyr bare at e-post er utelukket — telefon kan fortsatt brukes. */
export const PHONE_ONLY_REASONS: ReadonlySet<GateReason> = new Set([
  "ingen_epost",
  "epost_personnavn",
  "epost_ukjent",
  "epost_ugyldig",
])

export type GateInput = {
  segment?: string | null
  orgForm: string | null
  konkurs?: boolean | null
  employeeCount?: number | null
  isExistingCustomer?: boolean | null
  optedOut?: boolean
  emailClass?: EmailClass | null
  hasEmail: boolean
}

export type GateResult = { ok: true } | { ok: false; reason: GateReason; phoneOnly: boolean }

/** Lovkrav: stopper ALL kald e-post, også når Casper sender for hånd. */
export const LEGAL_GATE_REASONS: ReadonlySet<GateReason> = new Set([
  "orgform_enk",
  "avmeldt",
  "ingen_epost",
  "epost_personnavn",
  "epost_ugyldig",
])

/**
 * «auto»: maskinen sender — alle porter gjelder (lov + målgruppe).
 * «manual»: Casper sender selv fra lead-kortet — bare lovkravene stopper; om et
 * lite AS eller en ukjent adresse er verdt en e-post, er hans vurdering.
 */
export type GateMode = "auto" | "manual"

/**
 * Alle porter firmaet stryker på, i prioritert rekkefølge (firmagrunner før
 * adressegrunner). Tom liste = kan få kald e-post fra maskinen.
 */
export function collectGateReasons(input: GateInput): GateReason[] {
  const segment = getSegment(input.segment)
  const orgForm = input.orgForm?.trim().toUpperCase() || null
  const reasons: GateReason[] = []

  if (orgForm === "ENK") reasons.push("orgform_enk")
  else if (orgForm === "NUF") reasons.push("orgform_nuf")
  else if (!orgForm) reasons.push("orgform_ukjent")
  else if (!segment.orgForms.includes(orgForm)) reasons.push("orgform_annen")
  if (input.optedOut) reasons.push("avmeldt")
  if (input.konkurs) reasons.push("konkurs")
  if (input.isExistingCustomer) reasons.push("eksisterende_kunde")

  // Brreg viser ikke 1–4 ansatte; et AS uten registrert tall er under 5.
  if (typeof input.employeeCount === "number") {
    if (input.employeeCount < segment.fraAntallAnsatte || input.employeeCount > segment.tilAntallAnsatte) {
      reasons.push("ansatte_utenfor")
    }
  } else if (segment.fraAntallAnsatte >= 5) {
    reasons.push("ansatte_utenfor")
  }

  if (!input.hasEmail) reasons.push("ingen_epost")
  else if (input.emailClass === "personnavn") reasons.push("epost_personnavn")
  else if (input.emailClass === "ugyldig") reasons.push("epost_ugyldig")
  else if (!input.emailClass || !SENDABLE_EMAIL_CLASSES.has(input.emailClass)) reasons.push("epost_ukjent")

  return reasons
}

/** Kan dette firmaet få kald e-post? Første stopp vinner. I «manual» gjelder
 *  bare lovkravene (LEGAL_GATE_REASONS). */
export function checkColdEmailGates(input: GateInput, mode: GateMode = "auto"): GateResult {
  const reasons = collectGateReasons(input)
  const blocking = mode === "auto" ? reasons : reasons.filter((reason) => LEGAL_GATE_REASONS.has(reason))
  const first = blocking[0]
  return first ? { ok: false, reason: first, phoneOnly: PHONE_ONLY_REASONS.has(first) } : { ok: true }
}

export type ContactPolicy = "ukjent" | "epost_ok" | "kun_telefon" | "utenfor_icp" | "blokkert"

export const CONTACT_POLICY_LABELS: Record<ContactPolicy, string> = {
  ukjent: "Ikke sjekket",
  epost_ok: "Kan få e-post",
  kun_telefon: "Kun telefon",
  utenfor_icp: "Utenfor målgruppen",
  blokkert: "Skal ikke kontaktes",
}

const BLOCKING_REASONS: ReadonlySet<GateReason> = new Set(["avmeldt", "konkurs", "eksisterende_kunde"])

/** Samlet dom for lagring i prospects.contact_policy. */
export function contactPolicyFor(reasons: GateReason[]): ContactPolicy {
  if (reasons.length === 0) return "epost_ok"
  if (reasons.some((reason) => BLOCKING_REASONS.has(reason))) return "blokkert"
  if (reasons.includes("orgform_ukjent")) return "ukjent"
  if (reasons.every((reason) => PHONE_ONLY_REASONS.has(reason))) return "kun_telefon"
  return "utenfor_icp"
}

/** Statuser der vi fortsatt driver kaldsalg. Etter svar (dialog/demo/trial) eller
 *  som kunde er det en samtale, ikke uanmodet markedsføring — da gjelder ikke
 *  kaldportene (men avmelding gjelder alltid). */
export const COLD_STATUSES: ReadonlySet<string> = new Set(["ny", "kvalifisert", "kontaktet"])
