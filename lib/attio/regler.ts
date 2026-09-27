// Reglene for Attio-synken — rene funksjoner uten database eller nettverk, så
// de kan testes. Hvem som synkes, hvordan stegene heter på begge sider, og
// hva som står i notatene og oppgavene.

import { createHash } from "node:crypto"

import type { ProspectRow, ProspectStatus } from "@/lib/outreach/types"
import { REPLY_CLASS_LABELS, type ReplyClass } from "@/lib/outreach/inbox/classify"
import { formatNok, formatNorwegianDate, type AnalyseFacts } from "@/lib/outreach/varm-regler"

// ── Hvem ────────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["kontaktet", "dialog", "demo", "trial", "kunde"])

/**
 * «Varme og aktive»: analyse-leads, varme, alle vi har kontaktet, og alt fra
 * Kontaktet og utover — pluss alt som allerede ligger i Attio, så et lead som
 * blir tapt også blir tapt der.
 *
 * Et tapt lead sendes bare når det allerede er i Attio. Ellers ville oppsettet
 * laget en deal — med hele e-posthistorikken — for hvert tapt og avmeldt lead
 * vi noen gang har skrevet til.
 *
 * attio_skal_synkes i db/104 er litt rausere (den tar også tapte som er
 * kontaktet); den legger bare leadet i køen, og denne regelen avgjør.
 */
export function shouldSyncProspect(
  prospect: Pick<ProspectRow, "status" | "source" | "is_hot" | "last_contacted_at"> & {
    analyse_lead_id?: string | null
    attio_deal_id?: string | null
    attio_ignored?: boolean | null
  },
): boolean {
  if (prospect.attio_ignored) return false
  if (prospect.status === "ny") return false
  if (prospect.status === "tapt") return Boolean(prospect.attio_deal_id)
  return Boolean(
    prospect.attio_deal_id ||
      prospect.source === "analyse" ||
      prospect.analyse_lead_id ||
      prospect.is_hot ||
      prospect.last_contacted_at ||
      ACTIVE_STATUSES.has(prospect.status),
  )
}

// ── Nøkkelen ────────────────────────────────────────────────────────────────

/** Tilgangene synken trenger på Attio-nøkkelen. */
export const REQUIRED_SCOPES = [
  "record_permission:read-write",
  "object_configuration:read-write",
  "note:read-write",
  "task:read-write",
  "user_management:read",
  "webhook:read-write",
] as const

/** Mangler noen av tilgangene? «read-write» dekker «read». */
export function missingScopes(granted: string): string[] {
  const scopes = new Set(granted.split(/\s+/).filter(Boolean))
  return REQUIRED_SCOPES.filter((scope) => {
    if (scopes.has(scope)) return false
    if (scope.endsWith(":read") && scopes.has(`${scope}-write`)) return false
    return true
  })
}

// ── Stegene ─────────────────────────────────────────────────────────────────

/**
 * Stegene i Attio. «Lead» er Attios eget standardsteg, og det passer bedre enn
 * «Kald lead» — i Attio står også de varme analyse-leadene der.
 */
export const STAGE_TITLES: Record<Exclude<ProspectStatus, "ny">, string> = {
  kvalifisert: "Lead",
  kontaktet: "Kontaktet",
  dialog: "Dialog",
  demo: "Demo",
  trial: "Trial",
  kunde: "Vunnet",
  tapt: "Tapt",
}

/** Rekkefølgen stegene opprettes i. */
export const STAGE_ORDER = ["kvalifisert", "kontaktet", "dialog", "demo", "trial", "kunde", "tapt"] as const

/**
 * Tittel i Attio → status her. Tar også Attios standardsteg, så en deal som
 * flyttes til «Won 🎉» i et workspace der ingen har ryddet, fortsatt blir vunnet.
 */
const STAGE_ALIASES: Record<string, Exclude<ProspectStatus, "ny">> = {
  lead: "kvalifisert",
  "kald lead": "kvalifisert",
  "ny lead": "kvalifisert",
  kontaktet: "kontaktet",
  "in progress": "kontaktet",
  dialog: "dialog",
  demo: "demo",
  trial: "trial",
  "prøve": "trial",
  "prøveperiode": "trial",
  vunnet: "kunde",
  kunde: "kunde",
  won: "kunde",
  tapt: "tapt",
  lost: "tapt",
}

export function stageTitleFor(status: string): string | null {
  return status in STAGE_TITLES ? STAGE_TITLES[status as keyof typeof STAGE_TITLES] : null
}

export function statusForStageTitle(title: string | null | undefined): Exclude<ProspectStatus, "ny"> | null {
  if (!title) return null
  const key = title
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .trim()
  return STAGE_ALIASES[key] ?? null
}

// ── Kilde og lenke ──────────────────────────────────────────────────────────

export function sourceLabel(prospect: Pick<ProspectRow, "source"> & { analyse_lead_id?: string | null }): string {
  if (prospect.source === "analyse" || prospect.analyse_lead_id) return "Analysen på proanbud.no"
  if (prospect.source === "signup") return "Registrerte seg selv"
  if (prospect.source === "manual") return "Lagt til manuelt"
  return "Brønnøysund"
}

export function leadCardUrl(prospectId: string, appUrl: string): string {
  return new URL(`/selger/leads/${prospectId}`, appUrl).toString()
}

// ── Notatene ────────────────────────────────────────────────────────────────

/**
 * Tidspunktet et notat skal stå med i Attio. Attio avviser datoer i framtiden
 * og før 1970 — og received_at på svar er avsenderens egen Date-header, som kan
 * være hva som helst. Da bruker vi «nå» heller enn å la ett notat stoppe leadet.
 */
export function safeNoteDate(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null
  const time = Date.parse(iso)
  if (Number.isNaN(time) || time < 0) return null
  return time > now.getTime() ? now.toISOString() : new Date(time).toISOString()
}

/** Attio har tak på notater; vi kapper lenge før det, og sier fra når vi gjør det. */
export const NOTE_MAX_CHARS = 8000

function cap(text: string, max = NOTE_MAX_CHARS): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n…[kappet]`
}

export type NoteDraft = { title: string; content: string; createdAt: string | null }

export function emailNote(row: {
  subject: string | null
  body: string | null
  recipient_email: string
  template_id: string
  created_at: string
}): NoteDraft {
  const kind =
    row.template_id === "outreach-warm"
      ? "Oppfølging av analysen"
      : row.template_id === "selger-manual"
        ? "E-post"
        : "Salgs-e-post"
  return {
    title: `${kind}: ${row.subject || "(uten emne)"}`,
    content: cap([`Til: ${row.recipient_email}`, "", row.body || "(ingen tekst lagret)"].join("\n")),
    createdAt: row.created_at,
  }
}

export function replyNote(row: {
  from_email: string
  from_name: string | null
  subject: string | null
  classification: string | null
  summary: string | null
  text_body: string | null
  received_at: string | null
}): NoteDraft {
  const label = row.classification
    ? REPLY_CLASS_LABELS[row.classification as ReplyClass] ?? row.classification
    : "Svar"
  const from = row.from_name ? `${row.from_name} <${row.from_email}>` : row.from_email
  return {
    title: `Svar fra ${from}: ${label}`,
    content: cap(
      [
        row.subject ? `Emne: ${row.subject}` : null,
        row.summary ? `Sammendrag: ${row.summary}` : null,
        "",
        row.text_body || "",
      ]
        .filter((line) => line !== null)
        .join("\n"),
    ),
    createdAt: row.received_at,
  }
}

const CALL_OUTCOME_LABELS: Record<string, string> = {
  svar_interessert: "Fikk svar — interessert",
  svar_ikke_interessert: "Fikk svar — ikke interessert",
  ikke_svar: "Ikke svar",
  beskjed: "La igjen beskjed",
  feil_nummer: "Feil nummer",
}

/** Samtaler, notater og vunnet/tapt fra aktivitetsloggen. Flytting i pipelinen blir ikke notat — det er steget. */
export function activityNote(row: {
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}): NoteDraft | null {
  const meta = row.metadata ?? {}
  // Kom endringen fra Attio, står den allerede der. Et notat ville vært et ekko.
  if (meta.via === "attio") return null
  const note = typeof meta.note === "string" && meta.note.trim() ? meta.note.trim() : null

  if (row.action === "phone_call") {
    const outcome = typeof meta.outcome === "string" ? CALL_OUTCOME_LABELS[meta.outcome] ?? meta.outcome : null
    return { title: `Samtale${outcome ? `: ${outcome}` : ""}`, content: note ?? "", createdAt: row.created_at }
  }
  if (row.action === "note") {
    if (!note) return null
    return { title: "Notat", content: cap(note), createdAt: row.created_at }
  }
  if (row.action === "lost_prospect") {
    const reason = typeof meta.lostReason === "string" ? meta.lostReason : null
    return {
      title: `Tapt${reason ? `: ${reason}` : ""}`,
      content: note ?? (meta.automatic ? "Satt automatisk." : ""),
      createdAt: row.created_at,
    }
  }
  if (row.action === "won_prospect") {
    return { title: "Vunnet", content: note ?? (meta.automatic ? "Betaler — satt automatisk." : ""), createdAt: row.created_at }
  }
  return null
}

export function analyseNote(facts: AnalyseFacts): NoteDraft {
  return {
    title: "Kjørte analysen på proanbud.no",
    content: [
      facts.jobTitle ? `Jobb i eksempeltilbudet: ${facts.jobTitle}` : null,
      facts.offerTotal !== null ? `Sum: ${formatNok(facts.offerTotal)} kr eks. mva` : null,
      facts.trade || facts.detectedTrade ? `Fag: ${facts.trade || facts.detectedTrade}` : null,
      facts.services.length > 0 ? `Tjenester på nettsiden: ${facts.services.slice(0, 8).join(", ")}` : null,
      facts.website ? `Nettside: ${facts.website}` : null,
      `E-post: ${facts.email}`,
      facts.consentAt
        ? `Sa ja til oppfølging på e-post ${formatNorwegianDate(facts.consentAt)}.`
        : "Sa ikke ja til oppfølging på e-post — ring.",
    ]
      .filter(Boolean)
      .join("\n"),
    createdAt: facts.submittedAt,
  }
}

// ── Oppgavene ───────────────────────────────────────────────────────────────

const TASK_VERBS: Record<string, string> = { ring: "Ring", epost: "E-post", mote: "Møte", annet: "Oppgave" }

export function taskContent(
  task: { task_type: string; title: string | null; note: string | null },
  prospectName: string,
): string {
  const verb = TASK_VERBS[task.task_type] ?? "Oppgave"
  const title = task.title?.trim() || verb
  return [`${prospectName}: ${title}`, task.note?.trim() || null].filter(Boolean).join(" — ")
}

// ── Endret siden sist? ──────────────────────────────────────────────────────

/** Stabil hash av det vi skriver, så en uendret deal ikke skrives på nytt hver gang. */
export function payloadHash(value: unknown): string {
  const stable = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(stable)
    if (input && typeof input === "object") {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, stable((input as Record<string, unknown>)[key])]),
      )
    }
    return input
  }
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 32)
}
