import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureValidToken } from "@/lib/oauth"
import { requirePlanFeature } from "@/lib/billing/guards"
import { createProviderEvent, type CalendarProvider } from "@/lib/calendar/provider-push"
import { logServerError } from "@/lib/errors/log"

export const dynamic = "force-dynamic"

// Sikring mot patologisk store kalendere — importen er en engangskopiering i
// påkoblingsfasen, ikke en full historisk synk.
const MAX_IMPORT_EVENTS = 300

/**
 * POST /api/calendar/import  { provider: "google" | "microsoft" }
 *
 * Kopierer kommende avtaler fra den innebygde Proanbud-kalenderen til brukerens
 * nylig tilkoblede Google/Outlook-kalender. Kjøres fra import-dialogen rett
 * etter OAuth-tilkobling. Idempotent: avtaler som allerede har en link for
 * (bruker, leverandør) hoppes over, så et nytt kall aldri lager duplikater.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Du er ikke logget inn. Logg inn på nytt." }, { status: 401 })
    }

    const guard = await requirePlanFeature("kalender")
    if (!guard.ok) return guard.response

    const body = await request.json().catch(() => ({}))
    const provider: CalendarProvider | null =
      body?.provider === "google" || body?.provider === "microsoft" ? body.provider : null
    if (!provider) {
      return NextResponse.json({ error: "Ugyldig kalendertype." }, { status: 400 })
    }

    const providerName = provider === "google" ? "Google" : "Outlook"
    const valid = await ensureValidToken(user.id, provider)
    if (!valid?.access_token) {
      return NextResponse.json(
        { error: `Ingen ${providerName}-kalender er koblet til. Koble til først.` },
        { status: 400 }
      )
    }

    // Kommende avtaler i bedriftens kalender (RLS begrenser til brukerens bedrift).
    const { data: events, error } = await supabase
      .from("calendar_events")
      .select("id, title, description, starts_at, ends_at")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(MAX_IMPORT_EVENTS)

    if (error) {
      await logServerError({
        message: "Henting av avtaler for kalenderimport feilet",
        error,
        source: "api",
        route: "POST /api/calendar/import",
      })
      return NextResponse.json(
        { error: "Kunne ikke hente avtalene som skulle kopieres. Prøv igjen." },
        { status: 500 }
      )
    }

    const { data: links } = await supabase
      .from("calendar_event_links")
      .select("event_id")
      .eq("user_id", user.id)
      .eq("provider", provider)
    const alreadyLinked = new Set((links ?? []).map((l) => l.event_id))

    let imported = 0
    let skipped = 0
    let failed = 0

    for (const event of events ?? []) {
      if (alreadyLinked.has(event.id)) {
        skipped++
        continue
      }
      const externalId = await createProviderEvent(provider, valid.access_token, {
        title: event.title,
        description: event.description,
        start: event.starts_at,
        end: event.ends_at,
      })
      if (!externalId) {
        failed++
        continue
      }
      const { error: linkError } = await supabase.from("calendar_event_links").insert({
        event_id: event.id,
        user_id: user.id,
        provider,
        external_id: externalId,
      })
      if (linkError) {
        // Kopien finnes hos leverandøren, men linken mangler — logg så det kan
        // følges opp; uten link vil avtalen vises dobbelt i Proanbud.
        await logServerError({
          message: "Lagring av kalenderimport-link feilet",
          error: linkError,
          source: "api",
          route: "POST /api/calendar/import",
          level: "warning",
          context: { eventId: event.id, provider },
        })
        failed++
        continue
      }
      imported++
    }

    return NextResponse.json({ imported, skipped, failed })
  } catch (error) {
    await logServerError({
      message: "Kalenderimport til ekstern kalender feilet",
      error,
      source: "api",
      route: "POST /api/calendar/import",
    })
    return NextResponse.json(
      { error: "Kunne ikke kopiere avtalene til kalenderen. Prøv igjen." },
      { status: 500 }
    )
  }
}
