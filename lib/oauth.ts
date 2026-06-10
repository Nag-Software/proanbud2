import { createClient as createServerSupabase } from "./supabase/server"
import {
  MICROSOFT_CALENDAR_SCOPES,
  requireGoogleOAuthEnv,
  requireMicrosoftOAuthEnv,
} from "./calendar/oauth-config"

type Integration = {
  id: string
  user_id: string
  provider: string
  access_token?: string
  refresh_token?: string
  expires_at?: string | null
  scope?: string
}

async function getIntegrationForUser(userId: string, provider: string) {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from("calendar_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .limit(1)
    .single()

  return data as Integration | null
}

async function upsertIntegrationTokens(
  userId: string,
  provider: string,
  tokens: {
    access_token?: string
    refresh_token?: string | null
    expires_at?: string | null
    scope?: string | null
  }
) {
  const supabase = await createServerSupabase()
  await supabase.from("calendar_integrations").upsert(
    {
      user_id: userId,
      provider,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at ?? null,
      scope: tokens.scope,
    },
    { onConflict: "user_id,provider" }
  )
}

function shouldRefreshToken(expiresAt?: string | null) {
  if (!expiresAt) return true
  const expiresEpoch = Math.floor(new Date(expiresAt).getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)
  return expiresEpoch - 60 <= now
}

async function refreshGoogleToken(userId: string, integration: Integration) {
  if (!integration.refresh_token) return integration

  const { clientId, clientSecret } = requireGoogleOAuthEnv()

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: integration.refresh_token,
    grant_type: "refresh_token",
  })

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) {
    console.error("Google calendar token refresh failed:", data.error ?? res.statusText)
    return integration
  }

  const expires_at = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : integration.expires_at ?? null

  await upsertIntegrationTokens(userId, "google", {
    access_token: data.access_token,
    refresh_token: integration.refresh_token,
    expires_at,
    scope: data.scope ?? integration.scope ?? null,
  })

  return { ...integration, access_token: data.access_token, expires_at }
}

async function refreshMicrosoftToken(userId: string, integration: Integration) {
  if (!integration.refresh_token) return integration

  const { clientId, clientSecret } = requireMicrosoftOAuthEnv()

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: integration.refresh_token,
    grant_type: "refresh_token",
    scope: MICROSOFT_CALENDAR_SCOPES.join(" "),
  })

  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) {
    console.error("Microsoft calendar token refresh failed:", data.error ?? res.statusText)
    return integration
  }

  const expires_at = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : integration.expires_at ?? null

  const refresh_token = data.refresh_token ?? integration.refresh_token

  await upsertIntegrationTokens(userId, "microsoft", {
    access_token: data.access_token,
    refresh_token,
    expires_at,
    scope: data.scope ?? integration.scope ?? null,
  })

  return {
    ...integration,
    access_token: data.access_token,
    refresh_token,
    expires_at,
  }
}

export async function ensureValidToken(userId: string, provider: string) {
  const integration = await getIntegrationForUser(userId, provider)
  if (!integration) return null

  if (!shouldRefreshToken(integration.expires_at)) {
    return integration
  }

  if (provider === "google") return refreshGoogleToken(userId, integration)
  if (provider === "microsoft") return refreshMicrosoftToken(userId, integration)
  return integration
}

function toDateKey(dateTimeStr: string) {
  try {
    const d = new Date(dateTimeStr)
    const y = d.getFullYear()
    const m = `${d.getMonth() + 1}`.padStart(2, "0")
    const day = `${d.getDate()}`.padStart(2, "0")
    return `${y}-${m}-${day}`
  } catch {
    return dateTimeStr.split("T")[0]
  }
}

export async function fetchEvents(userId: string, from?: string, to?: string) {
  const supabase = await createServerSupabase()
  const { data: integrations } = await supabase
    .from("calendar_integrations")
    .select("provider")
    .eq("user_id", userId)
  const providers = (integrations ?? []).map((i: { provider: string }) => i.provider)

  const events: { id: string; title: string; date: string; provider: string }[] = []

  for (const provider of providers) {
    const integration = await ensureValidToken(userId, provider)
    if (!integration || !integration.access_token) continue

    if (provider === "google") {
      const timeMin = from ? new Date(from).toISOString() : new Date().toISOString()
      const timeMax = to
        ? new Date(to).toISOString()
        : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
      const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${integration.access_token}` },
      })
      if (!res.ok) continue
      const data = await res.json()
      ;(data.items ?? []).forEach((it: { id: string; summary?: string; start?: { dateTime?: string; date?: string } }) => {
        const start = it.start?.dateTime ?? it.start?.date
        if (!start) return
        events.push({
          id: it.id,
          title: it.summary ?? "(Ingen tittel)",
          date: toDateKey(start),
          provider: "google",
        })
      })
    }

    if (provider === "microsoft") {
      const start = from ? new Date(from).toISOString() : new Date().toISOString()
      const end = to
        ? new Date(to).toISOString()
        : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
      const url = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}`
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${integration.access_token}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      })
      if (!res.ok) continue
      const data = await res.json()
      ;(data.value ?? []).forEach((it: { id: string; subject?: string; start?: { dateTime?: string; date?: string } }) => {
        const startDate = it.start?.dateTime ?? it.start?.date
        if (!startDate) return
        events.push({
          id: it.id,
          title: it.subject ?? "(Ingen tittel)",
          date: toDateKey(startDate),
          provider: "microsoft",
        })
      })
    }
  }

  return events
}

export async function revokeIntegration(userId: string, provider: string) {
  const supabase = await createServerSupabase()
  await supabase
    .from("calendar_integrations")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider)
}

export async function createGoogleWatch(accessToken: string) {
  try {
    const webhookBase = process.env.WEBHOOK_BASE_URL
    if (!webhookBase) return null
    const channelId = `chan-${Math.random().toString(36).slice(2, 9)}`
    const body = {
      id: channelId,
      type: "web_hook",
      address: `${webhookBase.replace(/\/$/, "")}/api/webhooks/google`,
    }
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/watch`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) {
      const text = await res.text()
      console.warn("Google watch failed:", res.status, text)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn("createGoogleWatch error", e)
    return null
  }
}

export async function createMicrosoftSubscription(accessToken: string) {
  try {
    const webhookBase = process.env.WEBHOOK_BASE_URL
    if (!webhookBase) return null
    const exp = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const body = {
      changeType: "created,updated,deleted",
      notificationUrl: `${webhookBase.replace(/\/$/, "")}/api/webhooks/microsoft`,
      resource: "me/events",
      expirationDateTime: exp,
      clientState: "proanbud",
    }
    const res = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      console.warn("Microsoft subscription failed:", res.status, text)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn("createMicrosoftSubscription error", e)
    return null
  }
}

export default {
  getIntegrationForUser,
  ensureValidToken,
  fetchEvents,
  revokeIntegration,
  createGoogleWatch,
  createMicrosoftSubscription,
}
