import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret, encryptSecret } from "@/lib/integrations/shared/crypto"
import { refreshFikenAccessToken } from "@/lib/integrations/fiken/connector"
import type { FikenConnectionRow } from "@/lib/integrations/fiken/types"

// Refresh a few minutes before expiry. Personal-token connections never expire.
const REFRESH_BUFFER_MS = 5 * 60 * 1000

function encryptFikenToken(value: string) {
  return encryptSecret(value, ["FIKEN_ENCRYPTION_KEY", "TRIPLETEX_ENCRYPTION_KEY"])
}

function accessTokenNeedsRefresh(connection: FikenConnectionRow) {
  if (connection.auth_mode === "personal") {
    return false
  }
  if (!connection.access_token_enc) {
    return true
  }
  if (!connection.token_expires_at) {
    // Unknown expiry: refresh to be safe.
    return true
  }
  const expiresAt = new Date(connection.token_expires_at).getTime()
  if (Number.isNaN(expiresAt)) {
    return true
  }
  return expiresAt - Date.now() <= REFRESH_BUFFER_MS
}

export async function ensureFreshFikenConnection(
  connection: FikenConnectionRow
): Promise<FikenConnectionRow> {
  if (connection.sync_state === "disconnected") {
    throw new Error("Fiken connection is disconnected")
  }

  if (!accessTokenNeedsRefresh(connection)) {
    return connection
  }

  const refreshToken = decryptSecret(
    connection.refresh_token_enc,
    ["FIKEN_ENCRYPTION_KEY", "TRIPLETEX_ENCRYPTION_KEY"]
  )
  if (!refreshToken) {
    throw new Error("Fiken refresh token is missing")
  }

  const token = await refreshFikenAccessToken(refreshToken)

  const update: Record<string, unknown> = {
    access_token_enc: encryptFikenToken(token.accessToken),
    token_expires_at: token.expiresAt,
    sync_state: "connected",
    last_success_at: new Date().toISOString(),
    last_error_at: null,
    last_error_message: null,
  }
  // Fiken may rotate the refresh token — always persist the latest one.
  if (token.refreshToken) {
    update.refresh_token_enc = encryptFikenToken(token.refreshToken)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("fiken_connections")
    .update(update)
    .eq("company_id", connection.company_id)
    .select("*")
    .maybeSingle()

  if (error || !data) {
    throw new Error(`Failed to refresh Fiken session: ${error?.message || "unknown"}`)
  }

  return data as FikenConnectionRow
}

export async function getFreshFikenConnection(companyId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("fiken_connections")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load Fiken connection: ${error.message}`)
  }

  if (!data || data.sync_state === "disconnected") {
    return null
  }

  return ensureFreshFikenConnection(data as FikenConnectionRow)
}
