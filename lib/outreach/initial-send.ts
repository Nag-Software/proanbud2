// Core of the first cold-email step (step_index 0) for the outbound lead engine.
// Extracted from app/api/outreach/auto-send so it can be driven both by the manual
// "Full auto"-button (with a logged-in seller) and by the daily cron (no user).

import type { createAdminClient } from "@/lib/supabase/admin"
import { logSellerEmail } from "@/lib/selger/activity-log"
import { BRANSJE_LABELS, resolveBransje } from "@/lib/outreach/bransje"
import { buildExampleOfferUrl, EXAMPLE_OFFER_CTA_LABEL } from "@/lib/outreach/example-offers"
import { generateOutreachDraft } from "@/lib/outreach/draft"
import { isOptedOut, sendOutreachEmail } from "@/lib/outreach/send"

type AdminClient = ReturnType<typeof createAdminClient>

export type OutreachRunResult = { sent: number; skipped: number; failed: number }

type EligibleProspect = {
  id: string
  org_number: string
  name: string
  email: string | null
  city: string | null
  nace_code: string | null
  nace_description: string | null
  employee_count: number | null
  status: string
}

/**
 * Send the first cold email to up to `maxBatch` fresh prospects (status ny/kvalifisert,
 * has email, not an existing customer). Caller is responsible for the daily cap —
 * `maxBatch` should already be the remaining budget for today.
 */
export async function runInitialOutreach(
  admin: AdminClient,
  opts: { origin: string; sentByUserId: string | null; maxBatch: number },
): Promise<OutreachRunResult> {
  const result: OutreachRunResult = { sent: 0, skipped: 0, failed: 0 }
  if (opts.maxBatch <= 0) return result

  const { data: prospects, error } = await admin
    .from("prospects")
    .select("id, org_number, name, email, city, nace_code, nace_description, employee_count, status")
    .not("email", "is", null)
    .eq("is_existing_customer", false)
    .in("status", ["ny", "kvalifisert"])
    .order("created_at", { ascending: true })
    .limit(opts.maxBatch)

  if (error) {
    console.error("[outreach/initial-send] load failed", error)
    throw new Error("Kunne ikke hente prospekter")
  }

  const rows = (prospects ?? []) as EligibleProspect[]

  async function processOne(p: EligibleProspect) {
    if (!p.email) {
      result.skipped += 1
      return
    }
    try {
      if (await isOptedOut(admin, { email: p.email, orgNumber: p.org_number })) {
        result.skipped += 1
        await admin
          .from("prospects")
          .update({ status: "avvist", updated_at: new Date().toISOString() })
          .eq("id", p.id)
        return
      }

      // Pick a real, trade-specific example offer to show off ("vis, ikke fortell").
      const bransje = resolveBransje({ naceCode: p.nace_code, naceDescription: p.nace_description })
      const exampleLabel = BRANSJE_LABELS[bransje]

      const draft = await generateOutreachDraft({
        name: p.name,
        city: p.city,
        naceDescription: p.nace_description,
        employeeCount: p.employee_count,
        exampleLabel,
      })

      const unsubscribeUrl = `${opts.origin}/api/outreach/unsubscribe?p=${p.id}`
      await sendOutreachEmail({
        to: p.email,
        subject: draft.subject,
        body: draft.body,
        unsubscribeUrl,
        ctaUrl: buildExampleOfferUrl(bransje),
        ctaLabel: EXAMPLE_OFFER_CTA_LABEL,
      })

      const now = new Date().toISOString()
      await admin.from("prospect_outreach").insert({
        prospect_id: p.id,
        channel: "email",
        step_index: 0,
        status: "sent",
        ai_subject: draft.subject,
        ai_body: draft.body,
        sent_at: now,
        approved_by: opts.sentByUserId,
      })
      await admin
        .from("prospects")
        .update({ status: "kontaktet", last_contacted_at: now, updated_at: now })
        .eq("id", p.id)

      await logSellerEmail({
        sentBy: opts.sentByUserId,
        templateId: "outreach-cold",
        recipientEmail: p.email,
        companyId: null,
      })
      result.sent += 1
    } catch (err) {
      console.error("[outreach/initial-send] failed for", p.id, err)
      result.failed += 1
    }
  }

  // Bounded concurrency to be gentle on OpenAI/Resend.
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(rows.slice(i, i + 5).map(processOne))
  }

  return result
}
