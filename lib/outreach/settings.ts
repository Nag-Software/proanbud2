// Innstillingene maskinen styres av (db/91, én rad).
//
// `paused` er true fra seed. Maskinen sender ingenting før Casper selv har
// skrudd den på, uansett hvilken sendemodus som står i miljøet.

import { createAdminClient } from "@/lib/supabase/admin"
import type { SegmentKey } from "@/lib/outreach/segments"

export type ApprovalMode = "alt_manuelt" | "oppfolging_auto"

export type SelgerSettings = {
  paused: boolean
  pause_reason: string | null
  approval_mode: Record<string, ApprovalMode>
  daily_cap: number
  daily_new_drafts: number
  draft_ttl_days: number
  send_window: { dager: number[]; fra: string; til: string; tz: string }
  llm_daily_budget_usd: number
}

export const DEFAULT_SETTINGS: SelgerSettings = {
  paused: true,
  pause_reason: null,
  approval_mode: { handverker: "alt_manuelt", regnskapspartner: "alt_manuelt" },
  daily_cap: 10,
  daily_new_drafts: 20,
  draft_ttl_days: 5,
  send_window: { dager: [1, 2, 3, 4, 5], fra: "07:30", til: "15:30", tz: "Europe/Oslo" },
  llm_daily_budget_usd: 5,
}

/**
 * Leser innstillingene. Mangler raden eller tabellen (migrasjonen ikke kjørt),
 * får vi standardverdiene — og de har `paused: true`, så feilen gjør maskinen
 * stille, ikke løpsk.
 */
export async function loadSettings(): Promise<SelgerSettings> {
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("selger_settings")
      .select("*")
      .eq("id", "global")
      .maybeSingle()

    if (error || !data) return DEFAULT_SETTINGS

    return {
      paused: data.paused ?? true,
      pause_reason: data.pause_reason ?? null,
      approval_mode: (data.approval_mode as Record<string, ApprovalMode>) ?? DEFAULT_SETTINGS.approval_mode,
      daily_cap: data.daily_cap ?? DEFAULT_SETTINGS.daily_cap,
      daily_new_drafts: data.daily_new_drafts ?? DEFAULT_SETTINGS.daily_new_drafts,
      draft_ttl_days: data.draft_ttl_days ?? DEFAULT_SETTINGS.draft_ttl_days,
      send_window: (data.send_window as SelgerSettings["send_window"]) ?? DEFAULT_SETTINGS.send_window,
      llm_daily_budget_usd: Number(data.llm_daily_budget_usd ?? DEFAULT_SETTINGS.llm_daily_budget_usd),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function updateSettings(patch: Partial<SelgerSettings>): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from("selger_settings").update(patch).eq("id", "global")
}

/** Setter maskinen i pause med en grunn. Brukes av helsevakten i fase 2. */
export async function pauseMachine(reason: string): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("selger_settings")
    .update({ paused: true, pause_reason: reason, paused_at: new Date().toISOString() })
    .eq("id", "global")
}

export function approvalModeFor(settings: SelgerSettings, segment: SegmentKey): ApprovalMode {
  return settings.approval_mode[segment] ?? "alt_manuelt"
}
