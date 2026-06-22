// Automated follow-up sequence for the outbound lead engine ("kundemaskin").
//
// The first cold email is step_index 0. After it, prospects that are still in status
// 'kontaktet' (have not replied/converted/opted out — replies are marked manually,
// which drops them out) receive up to N follow-ups in the same thread, each after a
// configurable delay measured from the PREVIOUS step's sent_at.
//
// Idempotency: a step is "claimed" by inserting a 'queued' prospect_outreach row with
// ON CONFLICT DO NOTHING against the unique (prospect_id, step_index) index, so two
// overlapping runs can never double-send. If the send then fails, the claim row is
// deleted so the step can be retried on the next run.

import type { createAdminClient } from "@/lib/supabase/admin"
import { logSellerEmail } from "@/lib/selger/activity-log"
import { BRANSJE_LABELS, resolveBransje } from "@/lib/outreach/bransje"
import { buildExampleOfferUrl, EXAMPLE_OFFER_CTA_LABEL } from "@/lib/outreach/example-offers"
import { followupSubject, generateFollowupDraft } from "@/lib/outreach/draft"
import { isOptedOut, sendOutreachEmail } from "@/lib/outreach/send"
import type { OutreachRunResult } from "@/lib/outreach/initial-send"

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Delay in days before each follow-up, measured from the previous step's sent_at.
 * Index 0 → step 1 (after the first cold email), index 1 → step 2, etc.
 * The length of this array is the number of follow-ups (max step). Defaults to
 * 3 follow-ups at +3d, +6d, +9d; override with OUTREACH_FOLLOWUP_DELAYS="3,6,9".
 */
function getFollowupDelays(): number[] {
  const raw = process.env.OUTREACH_FOLLOWUP_DELAYS?.trim()
  if (raw) {
    const parsed = raw
      .split(",")
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (parsed.length > 0) return parsed
  }
  return [3, 6, 9]
}

type PrevStepRow = {
  id: string
  ai_subject: string | null
  prospect: {
    id: string
    org_number: string
    name: string
    email: string | null
    city: string | null
    nace_code: string | null
    nace_description: string | null
    employee_count: number | null
    status: string
    is_existing_customer: boolean
  } | null
}

/**
 * Send all due follow-ups, oldest step first, up to `maxBatch` emails total.
 * Caller owns the daily cap — `maxBatch` should be the remaining budget for today.
 */
export async function runOutreachFollowups(
  admin: AdminClient,
  opts: { origin: string; sentByUserId: string | null; maxBatch: number },
): Promise<OutreachRunResult> {
  const result: OutreachRunResult = { sent: 0, skipped: 0, failed: 0 }
  const delays = getFollowupDelays()
  let budget = opts.maxBatch

  for (let step = 1; step <= delays.length; step++) {
    if (budget <= 0) break
    const delayDays = delays[step - 1]
    const cutoff = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000).toISOString()

    // Prospects whose previous step was sent long enough ago and who are still in
    // the cold sequence (status 'kontaktet'). The status filter lives in JS because
    // it's on the embedded prospects row.
    const { data, error } = await admin
      .from("prospect_outreach")
      .select(
        "id, ai_subject, prospect:prospects!inner(id, org_number, name, email, city, nace_code, nace_description, employee_count, status, is_existing_customer)",
      )
      .eq("step_index", step - 1)
      .eq("status", "sent")
      .lte("sent_at", cutoff)
      .order("sent_at", { ascending: true })
      .limit(budget)

    if (error) {
      console.error("[outreach/followup] load failed for step", step, error)
      continue
    }

    const rows = ((data ?? []) as unknown as PrevStepRow[]).filter(
      (r) => r.prospect && r.prospect.status === "kontaktet" && !r.prospect.is_existing_customer && r.prospect.email,
    )

    const processOne = async (row: PrevStepRow) => {
      const p = row.prospect!
      if (budget <= 0) {
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

        // Atomically claim this step. ON CONFLICT DO NOTHING → empty array means a
        // concurrent run (or a previous run) already owns it; skip.
        const { data: claimed, error: claimErr } = await admin
          .from("prospect_outreach")
          .upsert(
            { prospect_id: p.id, channel: "email", step_index: step, status: "queued" },
            { onConflict: "prospect_id,step_index", ignoreDuplicates: true },
          )
          .select("id")
        if (claimErr) {
          console.error("[outreach/followup] claim failed for", p.id, claimErr)
          result.failed += 1
          return
        }
        if (!claimed || claimed.length === 0) {
          result.skipped += 1
          return
        }
        const rowId = claimed[0].id as string

        try {
          const subject = followupSubject(row.ai_subject)

          // Step 2 ("konkret nytte") links the trade-specific example offer;
          // steps 1 and 3 keep the default trial CTA.
          const bransje =
            step === 2 ? resolveBransje({ naceCode: p.nace_code, naceDescription: p.nace_description }) : null

          const { body } = await generateFollowupDraft(
            {
              name: p.name,
              city: p.city,
              naceDescription: p.nace_description,
              employeeCount: p.employee_count,
              exampleLabel: bransje ? BRANSJE_LABELS[bransje] : null,
            },
            step,
          )

          const unsubscribeUrl = `${opts.origin}/api/outreach/unsubscribe?p=${p.id}`
          await sendOutreachEmail({
            to: p.email!,
            subject,
            body,
            unsubscribeUrl,
            ctaUrl: bransje ? buildExampleOfferUrl(bransje) : undefined,
            ctaLabel: bransje ? EXAMPLE_OFFER_CTA_LABEL : undefined,
          })

          const now = new Date().toISOString()
          await admin
            .from("prospect_outreach")
            .update({
              status: "sent",
              ai_subject: subject,
              ai_body: body,
              sent_at: now,
              approved_by: opts.sentByUserId,
              updated_at: now,
            })
            .eq("id", rowId)
          await admin
            .from("prospects")
            .update({ last_contacted_at: now, updated_at: now })
            .eq("id", p.id)

          await logSellerEmail({
            sentBy: opts.sentByUserId,
            templateId: "outreach-followup",
            recipientEmail: p.email!,
            companyId: null,
          })
          result.sent += 1
          budget -= 1
        } catch (sendErr) {
          // Release the claim so the step can be retried next run.
          console.error("[outreach/followup] send failed for", p.id, "step", step, sendErr)
          await admin.from("prospect_outreach").delete().eq("id", rowId)
          result.failed += 1
        }
      } catch (err) {
        console.error("[outreach/followup] failed for", p.id, err)
        result.failed += 1
      }
    }

    // Bounded concurrency to be gentle on OpenAI/Resend.
    for (let i = 0; i < rows.length; i += 5) {
      if (budget <= 0) break
      await Promise.all(rows.slice(i, i + 5).map(processOne))
    }
  }

  return result
}
