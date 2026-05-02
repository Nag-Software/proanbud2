import { createClient as createServerSupabase } from "./supabase/server"
import { randomUUID } from "crypto"

export async function createState(provider: string, userId?: string | null, ttlMinutes = 10) {
  const supabase = await createServerSupabase()
  const id = randomUUID()
  const expires_at = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()
  await supabase.from("calendar_oauth_states").insert({ id, user_id: userId ?? null, provider, expires_at })
  return id
}

export async function consumeState(id: string) {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from("calendar_oauth_states")
    .select("id,user_id,provider,expires_at,used")
    .eq("id", id)
    .limit(1)
    .single()

  if (!data) return null
  if (data.used) return null
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null

  await supabase.from("calendar_oauth_states").update({ used: true }).eq("id", id)
  return data
}

export default { createState, consumeState }
