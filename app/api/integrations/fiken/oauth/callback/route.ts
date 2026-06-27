import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { encryptSecret } from "@/lib/integrations/shared/crypto"
import { exchangeFikenCode, getFikenCompanies } from "@/lib/integrations/fiken/connector"
import { enqueueFikenJob } from "@/lib/integrations/fiken/jobs"
import { processFikenQueueInBackground } from "@/lib/integrations/fiken/sync"

function encryptFikenToken(value: string) {
  return encryptSecret(value, ["FIKEN_ENCRYPTION_KEY", "TRIPLETEX_ENCRYPTION_KEY"])
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  const settingsUrl = `${origin}/min-bedrift/fiken`

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const oauthError = url.searchParams.get("error")

  if (oauthError) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=${encodeURIComponent(oauthError)}`)
  }
  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=missing_code`)
  }

  const admin = createAdminClient()

  // Validate + consume the CSRF state (single use, must not be expired).
  const { data: stateRow } = await admin
    .from("fiken_oauth_state")
    .select("state, company_id, redirect_to, code_verifier, expires_at")
    .eq("state", state)
    .maybeSingle()

  await admin.from("fiken_oauth_state").delete().eq("state", state)

  if (!stateRow || new Date(stateRow.expires_at).getTime() < Date.now()) {
    return NextResponse.redirect(`${settingsUrl}?fiken_error=invalid_state`)
  }

  const companyId = stateRow.company_id as string
  const redirectTo = stateRow.redirect_to || settingsUrl

  try {
    // Re-check mutual exclusivity at consume time.
    const { data: tripletex } = await admin
      .from("tripletex_connections")
      .select("sync_state")
      .eq("company_id", companyId)
      .maybeSingle()
    if (tripletex && tripletex.sync_state !== "disconnected") {
      return NextResponse.redirect(`${redirectTo}?fiken_error=accounting_conflict`)
    }

    const token = await exchangeFikenCode(code, stateRow.code_verifier)
    const companies = await getFikenCompanies(token.accessToken)
    const company = companies.find((c) => c.slug) || companies[0]

    if (!company?.slug) {
      return NextResponse.redirect(`${redirectTo}?fiken_error=no_company`)
    }

    const update: Record<string, unknown> = {
      company_id: companyId,
      auth_mode: "oauth",
      access_token_enc: encryptFikenToken(token.accessToken),
      token_expires_at: token.expiresAt,
      personal_token_enc: null,
      fiken_company_slug: company.slug,
      fiken_company_name: company.name || null,
      is_test_company: company.testCompany === true,
      sync_state: "connected",
      last_success_at: new Date().toISOString(),
      last_error_at: null,
      last_error_message: null,
    }
    if (token.refreshToken) {
      update.refresh_token_enc = encryptFikenToken(token.refreshToken)
    }

    const { error: upsertError } = await admin
      .from("fiken_connections")
      .upsert(update, { onConflict: "company_id" })

    if (upsertError) {
      return NextResponse.redirect(`${redirectTo}?fiken_error=save_failed`)
    }

    // Kick off the initial reconcile through the serialized worker (not inline here).
    await enqueueFikenJob({
      companyId,
      jobType: "reconcile.full",
      payload: { source: "connect" },
      idempotencyKey: `fiken:reconcile:${companyId}:${new Date().toISOString()}`,
    })
    processFikenQueueInBackground({ batchSize: 5, maxBatches: 10 })

    return NextResponse.redirect(`${redirectTo}?fiken_connected=1`)
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown"
    console.error("Fiken OAuth callback failed:", message)
    await logServerError({
      message: "Fiken OAuth callback failed",
      error,
      source: "api",
      route: "GET /api/integrations/fiken/oauth/callback",
    })
    return NextResponse.redirect(`${redirectTo}?fiken_error=oauth_failed`)
  }
}
