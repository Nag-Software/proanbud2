import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { loadSettings } from "@/lib/outreach/settings"

const clock = z.string().regex(/^\d{2}:\d{2}$/, "Klokkeslett må være tt:mm")

const schema = z.object({
  paused: z.boolean().optional(),
  pause_reason: z.string().max(300).nullable().optional(),
  daily_cap: z.number().int().min(0).max(200).optional(),
  daily_new_drafts: z.number().int().min(0).max(200).optional(),
  draft_ttl_days: z.number().int().min(1).max(30).optional(),
  llm_daily_budget_usd: z.number().min(0).max(200).optional(),
  send_window: z
    .object({
      dager: z.array(z.number().int().min(1).max(7)).min(1).max(7),
      fra: clock,
      til: clock,
      tz: z.string().max(64).optional(),
    })
    .optional(),
  approval_mode: z.record(z.string(), z.enum(["alt_manuelt", "oppfolging_auto"])).optional(),
})

export async function GET() {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error
  return NextResponse.json(await loadSettings())
}

/**
 * Endrer innstillingene. Å skru maskinen PÅ er den ene handlingen her som får
 * e-post til å forlate huset, så den logges med hvem som gjorde det.
 */
export async function PATCH(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Ugyldig forespørsel" },
      { status: 400 },
    )
  }

  const patch: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.send_window) {
    if (parsed.data.send_window.fra >= parsed.data.send_window.til) {
      return NextResponse.json({ error: "Vinduet må starte før det slutter" }, { status: 400 })
    }
    patch.send_window = { tz: "Europe/Oslo", ...parsed.data.send_window }
  }

  // Starter han maskinen igjen, skal ikke den gamle pausegrunnen bli stående.
  if (parsed.data.paused === false) {
    patch.pause_reason = null
    patch.paused_at = null
  } else if (parsed.data.paused === true) {
    patch.paused_at = new Date().toISOString()
  }

  const admin = createAdminClient()
  const { error } = await admin.from("selger_settings").update(patch).eq("id", "global")

  if (error) {
    return NextResponse.json(
      { error: "Kunne ikke lagre — er migrasjon db/91 kjørt?" },
      { status: 500 },
    )
  }

  if (parsed.data.paused !== undefined) {
    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: parsed.data.paused ? "pause_machine" : "resume_machine",
      targetType: "prospects",
      metadata: { reason: parsed.data.pause_reason ?? null },
    })
  }

  return NextResponse.json(await loadSettings())
}
