// Hva som skjer per svarklasse.
//
// Dette er stedet der maskinen slipper taket. Fra et svar kommer inn, eier
// Casper kontakten — maskinen stopper sekvensen, setter riktig status, lager
// oppgaven og varsler. Den svarer aldri selv.
//
//   positiv / spørsmål  stopp, status dialog, oppgave «Svar innen 2 t», varsel
//   ikke_nå             stopp, snooze til returdato (ellers 90 dager)
//   nei                 stopp, tapt — OG avmelding. En reservasjon respekteres,
//                       også når den er formulert som «nei takk».
//   avmelding           avmelding og tapt
//   feil_person         notat, ingen stopp — kanskje får vi rett adresse
//   autosvar            stopper IKKE. Neste steg flyttes til returdato + 2 dager
//   ikke_levert         avmelding (adressen finnes ikke)

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Classification, ReplyClass } from "@/lib/outreach/inbox/classify"
import { postponeSequence, stopSequence } from "@/lib/outreach/sequence"
import { recordUnsubscribe } from "@/lib/outreach/send"
import type { ProspectRow } from "@/lib/outreach/types"

type AdminClient = ReturnType<typeof createAdminClient>

/** Hvor lenge et «ikke nå» uten dato hviler. */
const SNOOZE_DAYS = 90

export type ApplyOutcome = {
  stopped: boolean
  notify: boolean
  status: string | null
  note: string
}

async function ensureTask(
  admin: AdminClient,
  prospectId: string,
  input: { type: "ring" | "epost"; title: string; dueInHours: number },
): Promise<void> {
  // Unik indeks på (prospect_id) der done_at is null: ett åpent gjøremål av
  // gangen. Finnes det allerede ett, er det Caspers — vi overstyrer ikke.
  const { data: existing } = await admin
    .from("prospect_tasks")
    .select("id")
    .eq("prospect_id", prospectId)
    .is("done_at", null)
    .maybeSingle()

  if (existing) return

  await admin.from("prospect_tasks").insert({
    prospect_id: prospectId,
    task_type: input.type,
    title: input.title,
    due_at: new Date(Date.now() + input.dueInHours * 60 * 60 * 1000).toISOString(),
  })
}

/**
 * Utfører handlingen for én klassifisert melding.
 *
 * Kaster aldri: en feil her skal ikke hindre at neste svar blir behandlet.
 */
export async function applyClassification(
  admin: AdminClient,
  prospect: ProspectRow,
  classification: Classification,
): Promise<ApplyOutcome> {
  const now = new Date().toISOString()
  const klasse: ReplyClass = classification.klasse

  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    await admin
      .from("prospects")
      .update({
        status,
        stage_entered_at: now,
        last_activity_at: now,
        updated_at: now,
        ...extra,
      })
      .eq("id", prospect.id)
  }

  try {
    switch (klasse) {
      case "positiv":
      case "sporsmal": {
        await stopSequence(admin, prospect.id, "svar")
        await setStatus("dialog", { pipeline_state: "overlevert" })
        await ensureTask(admin, prospect.id, {
          type: "epost",
          title: klasse === "positiv" ? "Svar på positivt svar" : "Svar på spørsmål",
          dueInHours: 2,
        })
        return {
          stopped: true,
          notify: true,
          status: "dialog",
          note: "Sekvensen er stoppet, og oppgaven ligger i «I dag».",
        }
      }

      case "ikke_na": {
        await stopSequence(admin, prospect.id, "svar")
        const snoozeUntil =
          classification.back_at ??
          new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString()
        await admin
          .from("prospects")
          .update({
            snoozed_until: snoozeUntil,
            pipeline_state: "overlevert",
            last_activity_at: now,
            updated_at: now,
          })
          .eq("id", prospect.id)
        return {
          stopped: true,
          notify: false,
          status: null,
          note: `Satt på vent til ${new Date(snoozeUntil).toLocaleDateString("nb-NO")}.`,
        }
      }

      case "nei": {
        await stopSequence(admin, prospect.id, "svar")
        await setStatus("tapt", { pipeline_state: "avsluttet" })
        // Et «nei takk» er en reservasjon mot videre markedsføring, selv om de
        // ikke brukte ordet avmelding. Da respekterer vi det som en avmelding.
        await recordUnsubscribe(admin, {
          email: prospect.email,
          orgNumber: prospect.org_number,
          reason: "svar_nei",
          domain: prospect.domain ?? null,
        })
        return { stopped: true, notify: false, status: "tapt", note: "Avmeldt og satt til tapt." }
      }

      case "avmelding": {
        await stopSequence(admin, prospect.id, "avmeldt")
        await setStatus("tapt", { pipeline_state: "avsluttet" })
        await recordUnsubscribe(admin, {
          email: prospect.email,
          orgNumber: prospect.org_number,
          reason: "svar_avmelding",
          domain: prospect.domain ?? null,
        })
        return { stopped: true, notify: false, status: "tapt", note: "Avmeldt." }
      }

      case "ikke_levert": {
        await stopSequence(admin, prospect.id, "bounce")
        await recordUnsubscribe(admin, {
          email: prospect.email,
          orgNumber: prospect.org_number,
          reason: "bounce",
          domain: prospect.domain ?? null,
        })
        await admin
          .from("prospects")
          .update({ pipeline_state: "kun_telefon", contact_policy: "kun_telefon", updated_at: now })
          .eq("id", prospect.id)
        return {
          stopped: true,
          notify: false,
          status: null,
          note: "Adressen finnes ikke — flyttet til telefonlisten.",
        }
      }

      case "feil_person": {
        // Ingen stopp: får vi en ny generisk adresse, er dette en åpning og
        // ikke et nei.
        await admin
          .from("prospects")
          .update({
            notes: [prospect.notes, `Feil person: ${classification.summary}`]
              .filter(Boolean)
              .join("\n"),
            last_activity_at: now,
            updated_at: now,
          })
          .eq("id", prospect.id)
        return {
          stopped: false,
          notify: true,
          status: null,
          note: "Notert. Sjekk om de oppga en annen kontakt.",
        }
      }

      case "autosvar": {
        // Stopper bevisst IKKE. Et fravær er ikke et svar — vi flytter bare
        // neste steg til de er tilbake, pluss to dager så de rekker å tømme
        // innboksen først.
        if (classification.back_at) {
          const back = new Date(classification.back_at)
          await postponeSequence(
            admin,
            prospect.id,
            new Date(back.getTime() + 2 * 24 * 60 * 60 * 1000),
          )
          return {
            stopped: false,
            notify: false,
            status: null,
            note: `Autosvar — neste steg flyttet til etter ${back.toLocaleDateString("nb-NO")}.`,
          }
        }
        return { stopped: false, notify: false, status: null, note: "Autosvar — ingen endring." }
      }

      default: {
        // Ukjent: maskinen gjetter ikke. Meldingen havner i «Ukjente svar», og
        // sekvensen pauses til Casper har sett på den.
        await stopSequence(admin, prospect.id, "svar")
        return {
          stopped: true,
          notify: true,
          status: null,
          note: "Klarte ikke å tolke svaret — sekvensen er stoppet, se over selv.",
        }
      }
    }
  } catch (error) {
    void logServerError({
      message: "Kunne ikke utføre handling for svar",
      level: "error",
      source: "worker",
      error,
      context: { prospectId: prospect.id, klasse },
    })
    return { stopped: false, notify: true, status: null, note: "Handlingen feilet — se over selv." }
  }
}
