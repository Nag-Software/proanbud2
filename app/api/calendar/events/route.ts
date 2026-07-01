import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureValidToken } from "@/lib/oauth"
import { enqueueCalendarTripletexSync } from "@/lib/integrations/tripletex/sync"
import { requirePlanFeature } from "@/lib/billing/guards"
import { logServerError } from "@/lib/errors/log"

interface CalendarEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  backgroundColor?: string
  textColor?: string
}

interface GoogleCalendarEvent {
  id: string
  summary?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
}

interface MicrosoftEvent {
  id: string
  subject?: string
  start?: { dateTime: string; timeZone: string }
  end?: { dateTime: string; timeZone: string }
}

export const dynamic = 'force-dynamic';

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

    // Fetch user's calendar integrations
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
      return NextResponse.json(
        { error: "Kunne ikke hente kalenderkoblingene dine. Prøv igjen." },
        { status: 500 }
      )
    }

    const events: CalendarEvent[] = []

    // Process each integration
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
          events.push(...googleEvents)
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
          events.push(...microsoftEvents)
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
    const { title, start, end, description, targetProvider, projectId } = body

    if (!title || !start || !end) {
      return NextResponse.json({ error: "Fyll inn tittel, start og slutt." }, { status: 400 })
    }

    // Try to find the requested provider, or just pick the first available one if none specified
    let query = supabase
      .from("calendar_integrations")
      .select("provider, access_token")
      .eq("user_id", user.id)

    if (targetProvider) {
      query = query.eq("provider", targetProvider)
    }

    const { data: integrations, error } = await query

    if (error || !integrations || integrations.length === 0) {
      return NextResponse.json(
        { error: "Ingen kalender er koblet til. Koble til Google- eller Microsoft-kalenderen din først." },
        { status: 400 }
      )
    }

    // Use the first available integration if targetProvider was not specified
    const integration = integrations[0]
    const validIntegration = await ensureValidToken(user.id, integration.provider)

    if (!validIntegration || !validIntegration.access_token) {
      return NextResponse.json(
        { error: "Kalenderkoblingen virker ikke lenger. Koble til kalenderen på nytt." },
        { status: 400 }
      )
    }

    if (validIntegration.provider === "google") {
      const url = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validIntegration.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: title,
          description: description,
          start: { dateTime: new Date(start).toISOString() },
          end: { dateTime: new Date(end).toISOString() },
        })
      })
      if (!res.ok) {
        throw new Error(await res.text())
      }
      const created = await res.json()
      const createdEventId = typeof created?.id === "string" ? `google-${created.id}` : null
      if (createdEventId) {
        await enqueueTripletexCalendarEvent({
          supabase,
          userId: user.id,
          eventId: createdEventId,
          projectId,
          title,
          description,
          start,
          end,
        })
      }
      return NextResponse.json(created)
    }

    if (validIntegration.provider === "microsoft") {
      const url = "https://graph.microsoft.com/v1.0/me/events"
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${validIntegration.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject: title,
          body: description ? { contentType: "Text", content: description } : undefined,
          start: { dateTime: new Date(start).toISOString(), timeZone: "UTC" },
          end: { dateTime: new Date(end).toISOString(), timeZone: "UTC" },
        })
      })
      if (!res.ok) {
        throw new Error(await res.text())
      }
      const created = await res.json()
      const createdEventId = typeof created?.id === "string" ? `ms-${created.id}` : null
      if (createdEventId) {
        await enqueueTripletexCalendarEvent({
          supabase,
          userId: user.id,
          eventId: createdEventId,
          projectId,
          title,
          description,
          start,
          end,
        })
      }
      return NextResponse.json(created)
    }

    return NextResponse.json({ error: "Denne kalendertypen støttes ikke." }, { status: 400 })
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
