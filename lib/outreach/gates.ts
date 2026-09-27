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

/** Domener som aldri er firmaets egen side, uansett hvor godt de matcher. */
export const DIRECTORY_DOMAINS = new Set([
  "proff.no",
  "purehelp.no",
  "gulesider.no",
  "1881.no",
  "brreg.no",
  "forvalt.no",
  "regnskapstall.no",
  "bizweb.no",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "mittanbud.no",
  "byggstart.no",
  "anbudstorget.no",
  "finn.no",
  "indeed.com",
  "nav.no",
  "wikipedia.org",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "google.com",
  "bing.com",
])

/** Katalog, sosialt medium eller søkemotor — aldri et firmas eget domene. */
export function isDirectoryDomain(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^www\./, "")
  return [...DIRECTORY_DOMAINS].some((bad) => value === bad || value.endsWith(`.${bad}`))
}

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

/** Vanlige fornavn i Norge (normalisert, uten æøå) — fanger «kasperjohansen@»,
 *  «roy@» og «john@» der Brreg-rollene ikke nevner personen (ansatte på
 *  /om-oss, eller firmaet er oppkalt etter en som ikke lenger sitter i rollene).
 *  Bare navn på minst tre bokstaver, og ingen som også er vanlige ord i et
 *  firmanavn («Rene», «Ask», «Mark»). */
const COMMON_FIRST_NAMES = new Set([
  "aase", "adrian", "age", "agnes", "ahmed", "aivars", "aksel", "aleksander", "alex", "alexander", "alf",
  "ali", "amalie", "anders", "andre", "andreas", "andrius", "andrzej", "anette", "anita", "anja", "ann",
  "anna", "anne", "annette", "anton", "arild", "arne", "arnfinn", "arnt", "artur", "arturas", "arvid",
  "asbjorn", "ase", "asgeir", "aslak", "asle", "asmund", "astrid", "atle", "aud", "audun", "aurimas",
  "aurora", "bard", "bengt", "bent", "bente", "berit", "bernt", "birger", "bjarne", "bjarte", "bjorg",
  "bjorge", "bjorn", "bjornar", "bodil", "borge", "borghild", "britt", "camilla", "caroline", "cecilie",
  "charlotte", "chris", "christian", "christine", "christoffer", "dag", "dagfinn", "dagny", "daniel",
  "darius", "dariusz", "david", "dmitri", "edvard", "egil", "eigil", "eilif", "einar", "eirik", "eirin",
  "eivind", "eli", "elias", "elin", "elisabeth", "elise", "ellen", "emil", "emilie", "emma", "endre", "erik",
  "erlend", "erling", "eskil", "espen", "ester", "eva", "even", "eyvind", "filip", "finn", "frank",
  "fredrik", "frida", "frode", "gaute", "geir", "georg", "gerd", "gintaras", "gisle", "gjermund", "gjert",
  "glenn", "grete", "grethe", "gro", "grzegorz", "gudmund", "gudrun", "gunhild", "gunn", "gunnar", "gunvor",
  "guri", "gustav", "guttorm", "haakon", "hakon", "hallgeir", "hallvard", "halvard", "halvor", "hanna",
  "hannah", "hanne", "hans", "harald", "harry", "hassan", "havard", "hege", "heidi", "helene", "helga",
  "helge", "helmer", "henning", "henriette", "henrik", "herman", "hermann", "hilde", "hugo", "ida", "idar",
  "igor", "inge", "ingeborg", "inger", "ingrid", "ingunn", "ingvild", "irene", "isak", "iselin", "ivan",
  "ivar", "iver", "jacek", "jack", "jacob", "jakob", "james", "jan", "janis", "janne", "jannicke", "janusz",
  "jardar", "jarl", "jarle", "jaroslaw", "jenny", "jens", "jesper", "jimmy", "joachim", "joakim", "johan",
  "johanne", "johannes", "john", "johnny", "jon", "jonas", "jorgen", "jorn", "jorund", "jorunn", "jostein",
  "julian", "julie", "jurgis", "juris", "kaare", "kai", "kaj", "kaja", "kamil", "kare", "karen", "kari",
  "karin", "karl", "karoline", "karsten", "kasper", "kathrine", "katrine", "kenneth", "kent", "ketil",
  "kevin", "kim", "kine", "kirsten", "kjartan", "kjell", "kjersti", "kjetil", "klaus", "knut", "kolbein",
  "kolbjorn", "konrad", "kristen", "kristian", "kristin", "kristina", "kristine", "kristofer", "kristoffer",
  "krzysztof", "kurt", "laila", "lars", "lasse", "leif", "leiv", "lene", "lillian", "lina", "linda", "line",
  "linn", "lisa", "lise", "liv", "lorentz", "ludvig", "lukas", "lukasz", "mads", "magnar", "magne",
  "magnhild", "magnus", "maja", "malin", "marcin", "marcus", "marek", "maren", "mari", "maria", "marianne",
  "marie", "marit", "marius", "mariusz", "markus", "marte", "marthe", "martin", "martine", "mathias",
  "mathilde", "mats", "mattias", "merete", "mette", "mia", "michael", "michal", "mikael", "mike", "mikkel",
  "mindaugas", "mohammad", "mohammed", "mona", "monica", "monika", "mons", "morten", "muhammad", "nicolai",
  "niklas", "nikolai", "nils", "nina", "nora", "oda", "odd", "oddbjorn", "oddgeir", "oddmund", "oddvar",
  "oistein", "oivind", "ola", "olaf", "olai", "olav", "ole", "oleg", "oliver", "olve", "omar", "oscar",
  "oskar", "ottar", "ove", "oystein", "oyvind", "paal", "pal", "patrick", "paul", "pawel", "peder", "per",
  "peter", "petter", "philip", "piotr", "preben", "rafal", "ragnar", "ragnhild", "ragnvald", "ralf", "randi",
  "rasmus", "rebecca", "reidar", "reidun", "reinert", "remi", "renate", "richard", "rikard", "rita", "roald",
  "roar", "robert", "robin", "roger", "rolf", "rolv", "ronny", "roy", "ruben", "rudi", "runar", "rune",
  "ruth", "sakarias", "sander", "sandra", "sara", "sebastian", "selma", "sergei", "sergey", "sigbjorn",
  "sigmund", "signe", "sigrid", "sigurd", "sigve", "silje", "simen", "sindre", "siri", "sissel", "siv",
  "sivert", "sjur", "slawomir", "snorre", "sofie", "solfrid", "solveig", "sondre", "sonja", "stale",
  "stefan", "steffen", "stein", "steinar", "stephen", "steve", "stian", "stig", "stine", "sturla", "sunniva",
  "susanne", "svein", "sveinung", "sven", "svend", "svenn", "sverre", "synne", "synnove", "syver", "tallak",
  "tarjei", "teodor", "terje", "thea", "theodor", "therese", "thomas", "thor", "thorbjorn", "thore",
  "thorleif", "tina", "tine", "tiril", "tobias", "tollef", "tom", "tomas", "tomasz", "tommy", "tone",
  "tonje", "tony", "tor", "torbjorn", "tore", "torfinn", "torgeir", "torgrim", "torhild", "torill", "torjus",
  "torkel", "torleif", "tormod", "torodd", "torolf", "torstein", "torunn", "torvald", "tove", "trine",
  "trond", "trude", "trygve", "trym", "turid", "tuva", "ulf", "ulrik", "unni", "vebjorn", "vegard", "vemund",
  "veronica", "vetle", "vibeke", "victoria", "vidar", "vigdis", "viggo", "vilde", "vilhelm", "vilje",
  "vladimir", "vytautas", "wenche", "william", "willy", "wojciech", "yngve", "yvonne", "zbigniew",
])

const STOP_TOKENS = new Set(["og", "i", "pa", "av", "the", "and", "med", "for", "til"])
export const LEGAL_SUFFIX_TOKENS = new Set(["as", "asa", "ans", "da", "enk", "nuf", "sa", "ba", "ks", "sp", "z", "o"])

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

/**
 * Heter firmaet det samme som en person — «John Kleveland AS», «Ola Nordmann
 * Bygg AS»? Da er fornavnet og ordet etter det et personnavn, også når
 * personen ikke står i Brreg-rollene. «john@kleveland.no» og
 * «johnkleveland@gmail.com» er Johns adresser, ikke firmaets, selv om de
 * matcher firmanavnet.
 */
export function personNameInCompanyName(companyTokens: string[]): string[] {
  const [first, second] = companyTokens
  if (!first || !second || !COMMON_FIRST_NAMES.has(first)) return []
  return GENERIC_NAME_TOKENS.has(second) || second.length < 3 ? [first] : [first, second]
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
 *  2. Personnavn i lokaldelen (fra Brreg-rollene, fra et firmanavn som er et
 *     personnavn, eller «a.b»-mønster med initial) → personnavn — også når
 *     etternavnet er firmanavnet (e.lunn@, john@ for John Kleveland AS).
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
  const personTokens = [
    ...new Set([...personNameTokens(input.personNames ?? []), ...personNameInCompanyName(companyTokens)]),
  ]
  const localNorm = normalizeForMatch(local.replace(/\d+$/, ""))
  const parts = localParts(local)
  const baseLocal = normalizeForMatch(local.replace(/\d+$/, ""))

  // 2) Personnavn slår alt: en rolleperson i lokaldelen, eller initial + navn.
  // Unntatt rene funksjonsadresser — «kontor@» er ikke Tor, og «administrasjon@»
  // er ikke Jon, selv om navnet står inni ordet.
  const initialPlusSurname = personTokens.some(
    (token) => localNorm.length === token.length + 1 && localNorm.endsWith(token),
  )
  const initialPlusName = parts.length >= 2 && parts.some((part) => part.length === 1)
  if (
    !ROLE_LOCALPARTS.has(baseLocal) &&
    (initialPlusSurname || initialPlusName || containsPersonName(localNorm, personTokens, companyTokens))
  ) {
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
