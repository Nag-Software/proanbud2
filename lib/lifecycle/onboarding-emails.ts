// Runner for aktiverings-/livssyklus-e-postene (velkomst, aktivering, verdi,
// win-back). Kjøres daglig av cron. Isolert fra den levende trial-reminders.ts.
//
// KILL-SWITCH: sender bare ekte e-post når LIFECYCLE_EMAILS === "on". Uten den
// kjører den som en ren dry-run — regner ut hva som VILLE blitt sendt, uten å
// kalle Resend, uten Stripe-rabatt-bivirkninger og uten å skrive seller_email_log
// (så ingenting «forbrukes» før du skrur den på).
//
// Idempotent: hver mal sendes maks én gang per bedrift (sjekker seller_email_log
// på (company_id, template_id)), på samme måte som prøve-påminnelsene.

import { Resend } from "resend"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { logSellerEmail } from "@/lib/selger/activity-log"
import { ensureWelcomeDiscount, applyWelcomeDiscountToSubscription } from "@/lib/billing/welcome-discount"
import { LIFECYCLE_TEMPLATES, type LifecycleTemplateInput } from "./onboarding-templates"
import { LIFECYCLE_TEMPLATE_IDS, pickLifecycleEmail, type LifecycleStage } from "./schedule"

type AdminClient = ReturnType<typeof createAdminClient>

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

function isLive(): boolean {
  return process.env.LIFECYCLE_EMAILS?.trim().toLowerCase() === "on"
}

/** Transaksjonell avsender på det verifiserte app-domenet — aldri kald-subdomenet. */
function getTransactionalFrom(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>"
}

export type LifecycleResult = {
  live: boolean
  considered: number
  sent: number
  skipped: number
  failed: number
  /** Hva som ville blitt sendt (fylles i dry-run). */
  wouldSend: { stage: LifecycleStage; companyId: string }[]
}

type ContactInfo = { email: string; name: string }

/** Primærkontakt: helst en admin-bruker, ellers tidligste bruker, ellers firmaets e-post. */
async function resolveContact(
  admin: AdminClient,
  companyId: string,
  companyEmail: string | null
): Promise<ContactInfo | null> {
  const { data: users } = await admin
    .from("users")
    .select("full_name, email, role, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: true })

  const admins = (users ?? []).filter((u) => u.role === "admin" && u.email)
  const pick = admins[0] ?? (users ?? []).find((u) => u.email)
  if (pick?.email) return { email: pick.email, name: pick.full_name || "der" }
  if (companyEmail) return { email: companyEmail, name: "der" }
  return null
}

async function alreadySent(admin: AdminClient, companyId: string, templateId: string): Promise<boolean> {
  const { count } = await admin
    .from("seller_email_log")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("template_id", templateId)
  return (count ?? 0) > 0
}

async function hasSentOffer(admin: AdminClient, companyId: string): Promise<boolean> {
  const { count } = await admin
    .from("offers")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .not("sent_at", "is", null)
  return (count ?? 0) > 0
}

async function offerStats(admin: AdminClient, companyId: string): Promise<{ offerCount: number; pipelineNok: number }> {
  const { data } = await admin
    .from("offers")
    .select("amount_nok, status, sent_at")
    .eq("company_id", companyId)
  const rows = data ?? []
  const offerCount = rows.length
  const pipelineNok = rows
    .filter((r) => r.sent_at != null && r.status !== "rejected")
    .reduce((sum, r) => sum + (Number(r.amount_nok) || 0), 0)
  return { offerCount, pipelineNok }
}

export async function runLifecycleEmails(admin: AdminClient): Promise<LifecycleResult> {
  const live = isLive()
  const result: LifecycleResult = { live, considered: 0, sent: 0, skipped: 0, failed: 0, wouldSend: [] }

  // Kandidater: bedrifter i prøve (tidlig fase) eller nettopp utløpt (win-back).
  const { data: billing, error } = await admin
    .from("company_billing")
    .select("company_id, status, trial_ends_at")
    .in("status", ["trialing", "canceled", "past_due"])

  if (error) {
    console.error("[lifecycle] load failed", error)
    throw new Error("Kunne ikke hente bedrifter for livssyklus-e-post")
  }

  for (const row of billing ?? []) {
    result.considered += 1
    const companyId = row.company_id as string

    try {
      const { data: company } = await admin
        .from("companies")
        .select("name, email, created_at")
        .eq("id", companyId)
        .maybeSingle()

      if (!company?.created_at) {
        result.skipped += 1
        continue
      }

      const signupAtMs = new Date(company.created_at as string).getTime()
      const trialEndsAtMs = row.trial_ends_at ? new Date(row.trial_ends_at as string).getTime() : null
      const status = row.status as string

      // hasSentOffer trengs bare for aktiverings-vinduet — men å hente den for
      // alle (få) kandidater er billig og holder pick-funksjonen ren.
      const sentOffer = await hasSentOffer(admin, companyId)

      const stage = pickLifecycleEmail({
        now: Date.now(),
        signupAtMs,
        status,
        trialEndsAtMs,
        hasSentOffer: sentOffer,
        hasPaid: status === "active",
      })

      if (!stage) {
        result.skipped += 1
        continue
      }

      const template = LIFECYCLE_TEMPLATES[stage]
      if (await alreadySent(admin, companyId, template.id)) {
        result.skipped += 1
        continue
      }

      // Dry-run: registrer hva som ville blitt sendt, men ingen bivirkninger.
      if (!live) {
        result.wouldSend.push({ stage, companyId })
        continue
      }

      const contact = await resolveContact(admin, companyId, (company.email as string | null) ?? null)
      if (!contact) {
        result.skipped += 1
        continue
      }

      // Velkomstkode kun der den hører hjemme (velkomst + win-back). Har
      // Stripe-bivirkninger, så den kjøres aldri i dry-run.
      let promoCode: string | null = null
      if (stage === "velkomst" || stage === "winback") {
        try {
          const discount = await ensureWelcomeDiscount(companyId)
          if (discount) {
            promoCode = discount.code
            await applyWelcomeDiscountToSubscription(companyId, discount)
          }
        } catch (err) {
          console.error("[lifecycle] velkomstrabatt feilet", companyId, err)
        }
      }

      const stats = stage === "verdi" ? await offerStats(admin, companyId) : undefined

      const input: LifecycleTemplateInput = {
        recipientName: contact.name,
        companyName: (company.name as string | null) ?? null,
        promoCode,
        stats,
      }

      const { data: sendData, error: sendError } = await resend.emails.send({
        from: getTransactionalFrom(),
        to: contact.email,
        subject: template.subject,
        html: template.buildHtml(input),
      })

      if (sendError) {
        console.error("[lifecycle] send failed", companyId, sendError)
        void logServerError({
          message: "Lifecycle: Resend-utsending feilet",
          error: sendError,
          level: "warning",
          source: "worker",
          route: "runLifecycleEmails",
          context: { companyId, templateId: template.id },
        })
        result.failed += 1
        continue
      }

      await logSellerEmail({
        sentBy: null,
        templateId: template.id,
        recipientEmail: contact.email,
        companyId,
        providerMessageId: sendData?.id ?? null,
      })
      result.sent += 1
    } catch (err) {
      console.error("[lifecycle] failed for", companyId, err)
      void logServerError({
        message: "Lifecycle e-post feilet for bedrift",
        error: err,
        level: "warning",
        source: "worker",
        route: "runLifecycleEmails",
        context: { companyId },
      })
      result.failed += 1
    }
  }

  return result
}

// Gjør stage-navnene lett tilgjengelige for logging/oversikt.
export { LIFECYCLE_TEMPLATE_IDS }
