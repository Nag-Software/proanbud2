import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/integrations/tripletex/crypto"
import {
  encryptConnectionTokens,
  refreshTripletexSession,
} from "@/lib/integrations/tripletex/connector"
import type { TripletexConnectionRow } from "@/lib/integrations/tripletex/types"

const REFRESH_BUFFER_MS = 24 * 60 * 60 * 1000

function sessionNeedsRefresh(connection: TripletexConnectionRow) {
  if (!connection.session_token_enc) {
    return true
  }

  if (!connection.session_expires_at) {
    return true
  }

  const expiresAt = new Date(connection.session_expires_at).getTime()
  if (Number.isNaN(expiresAt)) {
    return true
  }

  return expiresAt - Date.now() <= REFRESH_BUFFER_MS
}

export async function ensureFreshTripletexConnection(
  connection: TripletexConnectionRow
): Promise<TripletexConnectionRow> {
  if (connection.sync_state === "disconnected") {
    throw new Error("Tripletex connection is disconnected")
  }

  if (!sessionNeedsRefresh(connection)) {
    return connection
  }

  const consumerToken = decryptSecret(connection.consumer_token_enc)
  const employeeToken = decryptSecret(connection.employee_token_enc)

  if (!consumerToken || !employeeToken) {
    throw new Error("Tripletex tokens are missing")
  }

  const session = await refreshTripletexSession(consumerToken, employeeToken)
  const encrypted = encryptConnectionTokens({
    consumerToken,
    employeeToken,
    sessionToken: session.sessionToken,
  })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tripletex_connections")
    .update({
      ...encrypted,
      session_expires_at: session.expiresAt,
      sync_state: "connected",
      last_success_at: new Date().toISOString(),
      last_error_at: null,
      last_error_message: null,
    })
    .eq("company_id", connection.company_id)
    .select("*")
    .maybeSingle()

  if (error || !data) {
    throw new Error(`Failed to refresh Tripletex session: ${error?.message || "unknown"}`)
  }

  return data as TripletexConnectionRow
}

export async function getFreshTripletexConnection(companyId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("tripletex_connections")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load Tripletex connection: ${error.message}`)
  }

  if (!data || data.sync_state === "disconnected") {
    return null
  }

  return ensureFreshTripletexConnection(data as TripletexConnectionRow)
}
