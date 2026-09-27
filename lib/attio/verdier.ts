// Attio-formatene: hvordan verdiene våre skrives inn i Attios attributter.
// Samlet her, så resten av synken ikke trenger å kunne Attios JSON.

import type { ProspectRow } from "@/lib/outreach/types"
import { leadCardUrl, sourceLabel, stageTitleFor } from "@/lib/attio/regler"

/**
 * Egne attributter synken lager i oppsettet (lib/attio/oppsett.ts).
 *
 * Attio tillater ikke egne unike attributter på firmaer — domenet er det eneste
 * unike der. Proanbud-ID-en på firmaet er derfor et vanlig felt vi slår opp på
 * før vi lager et firma uten domene. På deals er den unik, og den er det vi
 * oppdaterer på.
 */
export const CUSTOM_ATTRIBUTES = {
  companies: [
    { api_slug: "proanbud_id", title: "Proanbud-ID", type: "text", is_unique: false },
    { api_slug: "org_nr", title: "Org.nr.", type: "text", is_unique: false },
    { api_slug: "telefon", title: "Telefon", type: "text", is_unique: false },
  ],
  deals: [
    { api_slug: "proanbud_id", title: "Proanbud-ID", type: "text", is_unique: true },
    { api_slug: "proanbud_lenke", title: "Lead-kort i Proanbud", type: "text", is_unique: false },
    { api_slug: "kilde", title: "Kilde", type: "text", is_unique: false },
  ],
} as const

export type RecordRef = { target_object: string; target_record_id: string }

export function recordRef(object: string, recordId: string): RecordRef {
  return { target_object: object, target_record_id: recordId }
}

/** Firmaet. Domenet bare når vi vet det — et tomt felt skal ikke slette Attios. */
export function companyValues(prospect: ProspectRow): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: prospect.name,
    proanbud_id: prospect.id,
  }
  if (prospect.domain) values.domains = [prospect.domain]
  if (prospect.org_number) values.org_nr = prospect.org_number
  if (prospect.phone) values.telefon = prospect.phone
  return values
}

/**
 * Personen. Bare adresser som tilhører et menneske: den som krysset av for
 * oppfølging, eller en navngitt adresse. post@firma.no er ikke en person.
 */
export function personEmailFor(prospect: ProspectRow): string | null {
  if (prospect.consent_email) return prospect.consent_email.toLowerCase()
  if (prospect.email_kind === "personnavn" && prospect.email) return prospect.email.toLowerCase()
  return null
}

export function personValues(email: string, companyId: string | null): Record<string, unknown> {
  const values: Record<string, unknown> = { email_addresses: [email] }
  if (companyId) values.company = [recordRef("companies", companyId)]
  return values
}

/**
 * Dealen. Steget og eieren tas bare med når de skal skrives: eieren når dealen
 * lages, steget når statusen har endret seg her (se attio_stage i db/104).
 */
export function dealValues(
  prospect: ProspectRow,
  input: {
    companyId: string | null
    personId: string | null
    appUrl: string
    includeStage: boolean
    ownerMemberId: string | null
  },
): Record<string, unknown> {
  const values: Record<string, unknown> = {
    name: prospect.name,
    proanbud_id: prospect.id,
    proanbud_lenke: leadCardUrl(prospect.id, input.appUrl),
    kilde: sourceLabel(prospect),
  }
  if (input.companyId) values.associated_company = [recordRef("companies", input.companyId)]
  if (input.personId) values.associated_people = [recordRef("people", input.personId)]
  if (input.includeStage) {
    const stage = stageTitleFor(prospect.status)
    if (stage) values.stage = stage
  }
  if (input.ownerMemberId) {
    values.owner = [{ referenced_actor_type: "workspace-member", referenced_actor_id: input.ownerMemberId }]
  }
  return values
}

/** Id-en ut av et record-svar: { data: { id: { record_id } } }. */
export function recordIdOf(response: unknown): string | null {
  const data = (response as { data?: { id?: { record_id?: string } } } | null)?.data
  return data?.id?.record_id ?? null
}

/** Stegtittelen ut av en deal: values.stage[0].status.title. */
export function stageTitleOf(record: unknown): string | null {
  const values = (record as { data?: { values?: Record<string, unknown> } } | null)?.data?.values
  const stage = values?.stage as Array<{ status?: { title?: string } }> | undefined
  return stage?.[0]?.status?.title ?? null
}
