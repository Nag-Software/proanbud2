/**
 * Skriver lokale Proanbud-avtaler til en tilkoblet Google-/Outlook-kalender.
 * Brukes av importen ved tilkobling (kopier eksisterende avtaler) og av
 * speilingen når en avtale opprettes/endres/slettes i Proanbud-kalenderen.
 * Kopien lagres i calendar_event_links (event_id, user_id, provider,
 * external_id) — den tabellen er sannhetskilden for hva som er kopiert.
 */

export type CalendarProvider = "google" | "microsoft"

export type PushableEvent = {
  title: string
  description?: string | null
  start: string
  end: string
}

function googleBody(event: PushableEvent) {
  return {
    summary: event.title,
    description: event.description || undefined,
    start: { dateTime: new Date(event.start).toISOString() },
    end: { dateTime: new Date(event.end).toISOString() },
  }
}

function microsoftBody(event: PushableEvent) {
  return {
    subject: event.title,
    body: event.description
      ? { contentType: "Text", content: event.description }
      : undefined,
    start: { dateTime: new Date(event.start).toISOString(), timeZone: "UTC" },
    end: { dateTime: new Date(event.end).toISOString(), timeZone: "UTC" },
  }
}

/** Oppretter avtalen hos leverandøren. Returnerer ekstern id, eller null ved feil. */
export async function createProviderEvent(
  provider: CalendarProvider,
  accessToken: string,
  event: PushableEvent
): Promise<string | null> {
  const url =
    provider === "google"
      ? "https://www.googleapis.com/calendar/v3/calendars/primary/events"
      : "https://graph.microsoft.com/v1.0/me/events"

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(provider === "google" ? googleBody(event) : microsoftBody(event)),
  })
  if (!res.ok) return null
  const created = await res.json()
  return typeof created?.id === "string" ? created.id : null
}

/** Oppdaterer en tidligere kopiert avtale. Returnerer false ved feil. */
export async function updateProviderEvent(
  provider: CalendarProvider,
  accessToken: string,
  externalId: string,
  event: PushableEvent
): Promise<boolean> {
  const url =
    provider === "google"
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(externalId)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(externalId)}`

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(provider === "google" ? googleBody(event) : microsoftBody(event)),
  })
  return res.ok
}

/**
 * Sletter en tidligere kopiert avtale. 404/410 regnes som suksess — kopien er
 * allerede borte (slettet manuelt hos leverandøren).
 */
export async function deleteProviderEvent(
  provider: CalendarProvider,
  accessToken: string,
  externalId: string
): Promise<boolean> {
  const url =
    provider === "google"
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(externalId)}`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(externalId)}`

  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return res.ok || res.status === 404 || res.status === 410
}
