import { NextResponse } from "next/server"
import crypto from "crypto"

import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { companyHasFeature } from "@/lib/billing/server-modules"
import {
  FIKEN_OAUTH_AUTHORIZE_URL,
  FIKEN_OAUTH_SCOPES,
  getFikenClientId,
  getFikenRedirectUri,
  hasFikenOAuthConfig,
} from "@/lib/integrations/fiken/config"

/**
 * Begin the Fiken OAuth2 authorization_code flow. Stores a CSRF `state` mapped to the
 * company, then redirects to Fiken's consent screen. Only admin/manager may connect,
 * and only when no other accounting provider (Tripletex) is already connected.
 */
export async function GET(request: Request) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const origin = new URL(request.url).origin
  const settingsUrl = `${origin}/min-bedrift/fiken`

  if (!user) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=unauthorized`)
  }

  const admin = createAdminClient()
  const { data: userRow } = await admin
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  const role = String(userRow?.role || "")
  if (!userRow?.company_id || !["admin", "manager"].includes(role)) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=forbidden`)
  }

  if (!(await companyHasFeature(userRow.company_id, "integrasjoner"))) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=plan_required`)
  }

  if (!hasFikenOAuthConfig()) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=not_configured`)
  }

  // Mutual exclusivity: refuse if Tripletex is the active accounting provider.
  const { data: tripletex } = await admin
    .from("tripletex_connections")
    .select("sync_state")
    .eq("company_id", userRow.company_id)
    .maybeSingle()
  if (tripletex && tripletex.sync_state !== "disconnected") {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=accounting_conflict`)
  }

  const state = crypto.randomBytes(24).toString("base64url")

  const { error: stateError } = await admin.from("fiken_oauth_state").insert({
    state,
    company_id: userRow.company_id,
    created_by: user.id,
    redirect_to: settingsUrl,
  })

  if (stateError) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=state_failed`)
  }

  const authorizeUrl = new URL(FIKEN_OAUTH_AUTHORIZE_URL)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("client_id", getFikenClientId())
  authorizeUrl.searchParams.set("redirect_uri", getFikenRedirectUri())
  authorizeUrl.searchParams.set("scope", FIKEN_OAUTH_SCOPES)
  authorizeUrl.searchParams.set("state", state)

  return NextResponse.redirect(authorizeUrl.toString())
}
