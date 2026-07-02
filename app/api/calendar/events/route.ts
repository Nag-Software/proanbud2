import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureValidToken } from "@/lib/oauth"
import { enqueueCalendarTripletexSync } from "@/lib/integrations/tripletex/sync"
import { requirePlanFeature } from "@/lib/billing/guards"
import {
  createProviderEvent,
  deleteProviderEvent,
  updateProviderEvent,
  type CalendarProvider,
  type PushableEvent,
} from "@/lib/calendar/provider-push"
import { logServerError } from "@/lib/errors/log"

// Kalendermodellen: den innebygde Proanbud-kalenderen (calendar_events, delt i
// bedriften, alle planer) er kjernen — id-prefiks "local-". Google/Outlook er
// gratis, valgfrie tilkoblinger: eksterne avtaler vises read/write i tillegg
// (prefiks "google-"/"ms-"), og lokale avtaler speiles best-effort til
// brukerens tilkoblede kalendere via calendar_event_links.

interface CalendarEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  backgroundColor?: string
  textColor?: string
  projectId?: string | null
}

export const dynamic = 'force-dynamic';

const LOCAL_PREFIX = "local-"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

async function userIntegrations(
  supabase: SupabaseServerClient,
  userId: string
): Promise<CalendarProvider[]> {
  const { data } = await supabase
    .from("calendar_integrations")
    .select("provider")
    .eq("user_id", userId)
  return (data ?? [])
    .map((i) => i.provider)
    .filter((p): p is CalendarProvider => p === "google" || p === "microsoft")
}

/**
 * Speil en lokal avtale til brukerens tilkoblede kalendere. Opprettelse skjer
 * kun der det ikke finnes en link fra før; oppdatering/sletting følger
 * eksisterende linker. Alt er best-effort — en død token-kobling skal aldri
 * velte selve kalenderoperasjonen.
 */
async function mirrorLocalEvent(
  supabase: SupabaseServerClient,
  userId: string,
  eventId: string,
  action: "create" | "update" | "delete",
  event?: PushableEvent
) {
  try {
    const { data: links } = await supabase
      .from("calendar_event_links")
      .select("provider, external_id")
      .eq("event_id", eventId)
      .eq("user_id", userId)
    const linkByProvider = new Map(
      (links ?? []).map((l) => [l.provider as CalendarProvider, l.external_id as string])
    )

    if (action === "create" && event) {
      for (const provider of await userIntegrations(supabase, userId)) {
        if (linkByProvider.has(provider)) continue
        const valid = await ensureValidToken(userId, provider)
        if (!valid?.access_token) continue
        const externalId = await createProviderEvent(provider, valid.access_token, event)
        if (externalId) {
          await supabase.from("calendar_event_links").insert({
            event_id: eventId,
            user_id: userId,
            provider,
            external_id: externalId,
          })
        }
      }
      return
    }

    for (const [provider, externalId] of linkByProvider) {
      const valid = await ensureValidToken(userId, provider)
      if (!valid?.access_token) continue
      if (action === "update" && event) {
        await updateProviderEvent(provider, valid.access_token, externalId, event)
      } else if (action === "delete") {
        await deleteProviderEvent(provider, valid.access_token, externalId)
      }
    }
  } catch (error) {
    await logServerError({
      message: "Speiling av kalenderavtale til ekstern kalender feilet",
      error,
      source: "api",
      route: "mirrorLocalEvent",
      level: "warning",
      context: { eventId, action },
    })
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const startParam = searchParams.get("start")
    const endParam = searchParams.get("end")

    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: "Mangler tidsrom for kalenderen. Last siden på nytt." },
        { status: 400 }
      )
    }

    // Ensure valid ISO strings (and handle cases where '+' became ' ' in URL)
    const start = new Date(startParam.replace(" ", "+")).toISOString()
    const end = new Date(endParam.replace(" ", "+")).toISOString()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Du er ikke logget inn. Logg inn på nytt." }, { status: 401 })
    }

    const plan = await requirePlanFeature("kalender")
    if (!plan.ok) return plan.response

    const events: CalendarEvent[] = []

    // Innebygd kalender — RLS begrenser til brukerens bedrift.
    const { data: localEvents, error: localError } = await supabase
      .from("calendar_events")
      .select("id, title, description, starts_at, ends_at, color, project_id")
      .lt("starts_at", end)
      .gt("ends_at", start)
      .order("starts_at")

    if (localError) {
      await logServerError({
        message: "Henting av Proanbud-kalenderavtaler feilet",
        error: localError,
        source: "api",
        route: "GET /api/calendar/events",
      })
      return NextResponse.json(
        { error: "Kunne ikke hente kalenderavtalene. Prøv igjen." },
        { status: 500 }
      )
    }

    for (const e of localEvents ?? []) {
      events.push({
        id: `${LOCAL_PREFIX}${e.id}`,
        title: e.title,
        description: e.description || "",
        start: e.starts_at,
        end: e.ends_at,
        backgroundColor: e.color || undefined,
        projectId: e.project_id,
      })
    }

    const { data: integrations, error } = await supabase
      .from("calendar_integrations")
      .select("id, provider, access_token, expires_at")
      .eq("user_id", user.id)

    if (error) {
      await logServerError({
        message: "Henting av kalenderkoblinger feilet",
        error,
        source: "api",
        route: "GET /api/calendar/events",
      })
      // Lokale avtaler er allerede hentet — vis dem fremfor å feile hele siden.
      return NextResponse.json(events)
    }

    // Avtaler som er kopiert fra Proanbud til brukerens eksterne kalender skal
    // ikke vises dobbelt — filtrer bort de eksterne kopiene via linktabellen.
    const { data: links } = await supabase
      .from("calendar_event_links")
      .select("provider, external_id")
      .eq("user_id", user.id)
    const mirroredExternalIds = new Set(
      (links ?? []).map((l) => `${l.provider}:${l.external_id}`)
    )

    for (const integration of integrations ?? []) {
      const validIntegration = await ensureValidToken(user.id, integration.provider)
      if (!validIntegration || !validIntegration.access_token) continue

      if (validIntegration.provider === "google") {
        try {
          const googleEvents = await fetchGoogleCalendarEvents(
            validIntegration.access_token,
            start,
            end
          )
          events.push(
            ...googleEvents.filter(
              (e) => !mirroredExternalIds.has(`google:${e.id.slice("google-".length)}`)
            )
          )
        } catch (err) {
          console.error("Error fetching Google Calendar events:", err)
          await logServerError({
            message: "Failed to fetch Google Calendar events",
            error: err,
            source: "api",
            route: "GET /api/calendar/events",
            level: "warning",
            context: { userId: user.id, provider: "google" },
          })
        }
      } else if (validIntegration.provider === "microsoft") {
        try {
          const microsoftEvents = await fetchMicrosoftCalendarEvents(
            validIntegration.access_token,
            start,
            end
          )
          events.push(
            ...microsoftEvents.filter(
              (e) => !mirroredExternalIds.has(`microsoft:${e.id.slice("ms-".length)}`)
            )
          )
        } catch (err) {
          console.error("Error fetching Microsoft Calendar events:", err)
          await logServerError({
            message: "Failed to fetch Microsoft Calendar events",
            error: err,
            source: "api",
            route: "GET /api/calendar/events",
            level: "warning",
            context: { userId: user.id, provider: "microsoft" },
          })
        }
      }
    }

    // Return an array of events which works for BigCalendar and similar calendar components
    return NextResponse.json(events)
  } catch (error) {
    console.error("Calendar events error:", error)
    await logServerError({
      message: "Calendar events GET failed",
      error,
      source: "api",
      route: "GET /api/calendar/events",
    })
    return NextResponse.json(
      { error: "Kunne ikke hente kalenderavtalene. Prøv igjen." },
      { status: 500 }
    )
  }
}

async function enqueueTripletexCalendarEvent(input: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  eventId: string
  projectId?: string | null
  title?: string | null
  description?: string | null
  start: string
  end: string
}) {
  const projectId = input.projectId?.trim()
  const title = input.title?.trim()
  if (!projectId || !title) {
    return
  }

  const { data: userRow } = await input.supabase
    .from("users")
    .select("company_id")
    .eq("id", input.userId)
    .maybeSingle()

  if (!userRow?.company_id) {
    return
  }

  void enqueueCalendarTripletexSync({
    companyId: userRow.company_id,
    eventId: input.eventId,
    projectId,
    title,
    description: input.description || null,
    start: input.start,
    end: input.end,
  }).catch((error) => {
    console.error("Tripletex calendar sync enqueue failed:", error)
    void logServerError({
      message: "Tripletex calendar sync enqueue failed",
      error,
      source: "api",
      route: "enqueueTripletexCalendarEvent",
      level: "warning",
      companyId: userRow.company_id,
      userId: input.userId,
      context: { eventId: input.eventId, projectId },
    })
  })
}

async function fetchGoogleCalendarEvents(
  accessToken: string,
  start: string,
  end: string
): Promise<CalendarEvent[]> {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events"
  )
  url.searchParams.set("singleEvents", "true")
  url.searchParams.set("orderBy", "startTime")
  url.searchParams.set("timeMin", start)
  url.searchParams.set("timeMax", end)

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Google Calendar API error: ${response.statusText}`)
  }

  const data = await response.json()
    const events: CalendarEvent[] = (data.items ?? []).map(
    (event: any) => ({
      id: `google-${event.id}`,
      title: event.summary || "Opptatt",
      description: event.description || "",
      start: event.start?.dateTime || event.start?.date || "",
      end: event.end?.dateTime || event.end?.date || "",
      backgroundColor: "#4285F4", // Google Blue
      textColor: "#ffffff"
    })
  )

  return events
}

async function fetchMicrosoftCalendarEvents(
  accessToken: string,
  start: string,
  end: string
): Promise<CalendarEvent[]> {
  const url = new URL("https://graph.microsoft.com/v1.0/me/calendarview")
  url.searchParams.set("startDateTime", start)
  url.searchParams.set("endDateTime", end)
  url.searchParams.set("$select", "subject,bodyPreview,start,end,id")

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Prefer": 'outlook.timezone="UTC"'
    },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new Error(`Microsoft Graph API error: ${response.statusText}`)
  }

  const data = await response.json()
  const events: CalendarEvent[] = (data.value ?? []).map(
    (event: any) => {
      // MS Graph gives "2026-03-21T10:00:00.0000000" if UTC is required. We append Z to make it format nicely.
      const startDate = event.start?.dateTime ? `${event.start.dateTime}Z` : ""
      const endDate = event.end?.dateTime ? `${event.end.dateTime}Z` : ""

      return {
        id: `ms-${event.id}`,
        title: event.subject || "Opptatt",
        description: event.bodyPreview || "",
        start: startDate,
        end: endDate,
        backgroundColor: "#0078D4", // MS Blue
        textColor: "#ffffff"
      }
    }
  )

  return events
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Du er ikke logget inn. Logg inn på nytt." }, { status: 401 })
    }

    const plan = await requirePlanFeature("kalender")
    if (!plan.ok) return plan.response

    const body = await request.json()
    const { title, start, end, description, color, projectId } = body

    if (!title || !start || !end) {
      return NextResponse.json({ error: "Fyll inn tittel, start og slutt." }, { status: 400 })
    }

    // Nye avtaler lagres alltid i den innebygde Proanbud-kalenderen.
    const { data: created, error } = await supabase
      .from("calendar_events")
      .insert({
        company_id: plan.context.companyId,
        created_by: user.id,
        title: String(title).trim(),
        description: description || null,
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
        color: color || null,
        project_id: projectId || null,
      })
      .select("id")
      .single()

    if (error || !created) {
      await logServerError({
        message: "Oppretting av kalenderavtale feilet",
        error,
        source: "api",
        route: "POST /api/calendar/events",
      })
      return NextResponse.json(
        { error: "Kunne ikke opprette avtalen i kalenderen. Prøv igjen." },
        { status: 500 }
      )
    }

    const eventId = `${LOCAL_PREFIX}${created.id}`

    await enqueueTripletexCalendarEvent({
      supabase,
      userId: user.id,
      eventId,
      projectId,
      title,
      description,
      start,
      end,
    })

    // Speil til brukerens tilkoblede Google/Outlook-kalendere.
    await mirrorLocalEvent(supabase, user.id, created.id, "create", {
      title,
      description,
      start,
      end,
    })

    return NextResponse.json({ id: eventId })
  } catch (error: any) {
    console.error("Error creating event:", error)
    await logServerError({
      message: "Calendar event create (POST) failed",
      error,
      source: "api",
      route: "POST /api/calendar/events",
    })
    return NextResponse.json(
      { error: "Kunne ikke opprette avtalen i kalenderen. Prøv igjen." },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Du er ikke logget inn. Logg inn på nytt." }, { status: 401 })

    const plan = await requirePlanFeature("kalender")
    if (!plan.ok) return plan.response

    const body = await request.json()
    const { eventId, start, end, title, description, color, projectId } = body
    if (!eventId || !start || !end) return NextResponse.json({ error: "Mangler informasjon om avtalen. Prøv igjen." }, { status: 400 })

    // Innebygd Proanbud-avtale?
    if (eventId.startsWith(LOCAL_PREFIX)) {
      const localId = eventId.slice(LOCAL_PREFIX.length)
      const update: Record<string, unknown> = {
        starts_at: new Date(start).toISOString(),
        ends_at: new Date(end).toISOString(),
        updated_at: new Date().toISOString(),
      }
      if (title !== undefined) update.title = String(title).trim()
      if (description !== undefined) update.description = description || null
      if (color !== undefined) update.color = color || null
      if (projectId !== undefined) update.project_id = projectId || null

      const { data: updated, error } = await supabase
        .from("calendar_events")
        .update(update)
        .eq("id", localId)
        .select("id, title, description, starts_at, ends_at")
        .maybeSingle()

      if (error || !updated) {
        await logServerError({
          message: "Oppdatering av kalenderavtale feilet",
          error,
          source: "api",
          route: "PATCH /api/calendar/events",
          context: { eventId },
        })
        return NextResponse.json(
          { error: "Kunne ikke lagre endringen i kalenderavtalen. Prøv igjen." },
          { status: 500 }
        )
      }

      await enqueueTripletexCalendarEvent({
        supabase,
        userId: user.id,
        eventId,
        projectId,
        title: updated.title,
        description: updated.description,
        start,
        end,
      })

      await mirrorLocalEvent(supabase, user.id, localId, "update", {
        title: updated.title,
        description: updated.description,
        start,
        end,
      })

      return NextResponse.json({ success: true })
    }

    // eventId is custom prefixed, e.g. "google-12345" or "ms-67890"
    const isGoogle = eventId.startsWith("google-")
    const isMicrosoft = eventId.startsWith("ms-")
    const provider = isGoogle ? "google" : isMicrosoft ? "microsoft" : null
    const realEventId = eventId.replace(/^(google-|ms-)/, "")

    if (!provider) return NextResponse.json({ error: "Fant ikke kalenderen denne avtalen hører til." }, { status: 400 })

    const validIntegration = await ensureValidToken(user.id, provider)

    if (!validIntegration?.access_token) return NextResponse.json({ error: "Kalenderkoblingen er utløpt. Koble til kalenderen på nytt." }, { status: 400 })

    if (isGoogle) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${realEventId}`
      const updateBody: any = {
        start: { dateTime: new Date(start).toISOString() },
        end: { dateTime: new Date(end).toISOString() },
      }

      if (title !== undefined) updateBody.summary = title
      if (description !== undefined) updateBody.description = description

      // Google Calendar API uses specific colorId out of ~11 colors. Map hex to IDs if possible, or just ignore.
      // We will skip colorId setting unless exact mapping is built, or optionally send it.

      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validIntegration.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateBody)
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      await enqueueTripletexCalendarEvent({
        supabase,
        userId: user.id,
        eventId,
        projectId,
        title,
        description,
        start,
        end,
      })
      return NextResponse.json(updated)
    }

    if (isMicrosoft) {
      const url = `https://graph.microsoft.com/v1.0/me/events/${realEventId}`
      const updateBody: any = {
        start: { dateTime: new Date(start).toISOString(), timeZone: "UTC" },
        end: { dateTime: new Date(end).toISOString(), timeZone: "UTC" },
      }

      if (title !== undefined) updateBody.subject = title
      if (description !== undefined) updateBody.body = { contentType: "Text", content: description }

      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${validIntegration.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateBody)
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      await enqueueTripletexCalendarEvent({
        supabase,
        userId: user.id,
        eventId,
        projectId,
        title,
        description,
        start,
        end,
      })
      return NextResponse.json(updated)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    await logServerError({
      message: "Calendar event update (PATCH) failed",
      error,
      source: "api",
      route: "PATCH /api/calendar/events",
    })
    return NextResponse.json(
      { error: "Kunne ikke lagre endringen i kalenderavtalen. Prøv igjen." },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Du er ikke logget inn. Logg inn på nytt." }, { status: 401 })

    const plan = await requirePlanFeature("kalender")
    if (!plan.ok) return plan.response

    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get("eventId")

    if (!eventId) return NextResponse.json({ error: "Fant ikke avtalen som skulle slettes." }, { status: 400 })

    if (eventId.startsWith(LOCAL_PREFIX)) {
      const localId = eventId.slice(LOCAL_PREFIX.length)

      // Slett brukerens egne eksterne kopier først (best-effort). Kopier andre
      // kolleger har importert til SIN kalender kan vi ikke nå med denne
      // brukerens tokens — de blir liggende hos leverandøren.
      await mirrorLocalEvent(supabase, user.id, localId, "delete")

      const { error } = await supabase.from("calendar_events").delete().eq("id", localId)
      if (error) {
        await logServerError({
          message: "Sletting av kalenderavtale feilet",
          error,
          source: "api",
          route: "DELETE /api/calendar/events",
          context: { eventId },
        })
        return NextResponse.json(
          { error: "Kunne ikke slette avtalen fra kalenderen. Prøv igjen." },
          { status: 500 }
        )
      }
      return NextResponse.json({ success: true })
    }

    const isGoogle = eventId.startsWith("google-")
    const isMicrosoft = eventId.startsWith("ms-")
    const provider = isGoogle ? "google" : isMicrosoft ? "microsoft" : null
    const realEventId = eventId.replace(/^(google-|ms-)/, "")

    if (!provider) return NextResponse.json({ error: "Fant ikke kalenderen denne avtalen hører til." }, { status: 400 })

    const validIntegration = await ensureValidToken(user.id, provider)

    if (!validIntegration?.access_token) return NextResponse.json({ error: "Kalenderkoblingen er utløpt. Koble til kalenderen på nytt." }, { status: 400 })

    if (isGoogle) {
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${realEventId}`
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${validIntegration.access_token}`,
        },
      })
      if (!res.ok) throw new Error(await res.text())
      return NextResponse.json({ success: true })
    }

    if (isMicrosoft) {
      const url = `https://graph.microsoft.com/v1.0/me/events/${realEventId}`
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${validIntegration.access_token}`,
        },
      })
      if (!res.ok) throw new Error(await res.text())
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    await logServerError({
      message: "Calendar event delete (DELETE) failed",
      error,
      source: "api",
      route: "DELETE /api/calendar/events",
    })
    return NextResponse.json(
      { error: "Kunne ikke slette avtalen fra kalenderen. Prøv igjen." },
      { status: 500 }
    )
  }
}
