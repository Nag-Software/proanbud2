// Broen fra analyse_leads til prospekter, og «gaven».
//
// Noen som har kjørt analysen på proanbud.no har gjort langt mer enn å åpne en
// e-post: de har skrevet inn nettsiden sin og ventet på et svar. Det er det
// sterkeste intensjonssignalet vi har.
//
// Derfor to regler:
//
//   1. De havner i pipelinen som VARME, med source='analyse'.
//   2. De settes ALDRI inn i en kald sekvens. Å sende «hei, jeg så dere driver
//      med tak» til noen som nettopp ba oss om et tilbudsutkast er å late som
//      man ikke kjenner dem.
//
// «Gaven» er den andre veien: en lenke til analysen med nettsiden deres
// forhåndsutfylt, slik at de slipper å skrive den inn. Den brukes i steg 3 og
// i svar, og matches tilbake via analyse_leads.utm.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { normalizeDomain } from "@/lib/analyse-leads/queries"
import { classifyContactEmail, contactPolicyFor, collectGateReasons } from "@/lib/outreach/gates"
import { resolveTrade } from "@/lib/outreach/segments"
import { buildAnalyseGiftUrl } from "@/lib/outreach/lenker"

export { buildAnalyseGiftUrl }

export type BridgeSummary = {
  considered: number
  created: number
  linked: number
  skipped: number
  notes: string[]
}

type AnalyseRow = {
  id: string
  email: string
  website: string | null
  domain: string | null
  company_name: string | null
  location: string | null
  phone: string | null
  company_email: string | null
  detected_trade: string | null
  trade: string | null
  utm: string | null
  submitted_at: string | null
}

/**
 * Speiler analyse-leads inn i prospekter.
 *
 * Tre utfall per rad:
 *   - `utm` matcher et sporingstoken → koble analysen til prospektet vi allerede har
 *   - domenet finnes som prospekt    → marker det varmt
 *   - ellers                         → opprett et nytt, varmt prospekt
 */
export async function bridgeAnalyseLeads(options: { limit?: number } = {}): Promise<BridgeSummary> {
  const summary: BridgeSummary = {
    considered: 0,
    created: 0,
    linked: 0,
    skipped: 0,
    notes: [],
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("analyse_leads")
      .select(
        "id, email, website, domain, company_name, location, phone, company_email, detected_trade, trade, utm, submitted_at",
      )
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(options.limit ?? 100)

    if (error || !data) {
      summary.notes.push(error?.message ?? "Ingen analyse-leads")
      return summary
    }

    const now = new Date().toISOString()

    for (const row of data as AnalyseRow[]) {
      summary.considered += 1

      const domain = row.domain || normalizeDomain(row.website) || normalizeDomain(row.email)
      if (!domain) {
        summary.skipped += 1
        continue
      }

      // 1) Kom de via en lenke vi sendte? Da vet vi nøyaktig hvem det er.
      const token = row.utm?.trim() || null
      if (token) {
        const { data: byToken } = await admin
          .from("prospects")
          .select("id")
          .eq("tracking_token", token)
          .maybeSingle<{ id: string }>()

        if (byToken) {
          await admin
            .from("prospects")
            .update({
              is_hot: true,
              hot_since: now,
              last_activity_at: now,
              pipeline_state: "overlevert",
              updated_at: now,
              notes: `Kjørte analysen på proanbud.no ${row.submitted_at?.slice(0, 10) ?? ""}`,
            })
            .eq("id", byToken.id)
          summary.linked += 1
          continue
        }
      }

      // 2) Kjenner vi domenet fra før?
      const { data: byDomain } = await admin
        .from("prospects")
        .select("id, status")
        .eq("domain", domain)
        .limit(1)

      const existing = (byDomain ?? [])[0] as { id: string; status: string } | undefined
      if (existing) {
        await admin
          .from("prospects")
          .update({
            is_hot: true,
            hot_since: now,
            last_activity_at: now,
            source: "analyse",
            updated_at: now,
          })
          .eq("id", existing.id)
        summary.linked += 1
        continue
      }

      // 3) Nytt prospekt. Varmt, og aldri i en kald sekvens.
      const email = row.company_email || row.email
      const emailClass = classifyContactEmail(email, {
        companyName: row.company_name || domain,
        companyDomain: domain,
      })

      // Portene gjelder fortsatt — men her er e-posten oppgitt av dem selv, så
      // grunnlaget er samtykke og ikke berettiget interesse.
      const gateReasons = collectGateReasons({
        segment: "handverker",
        orgForm: "AS",
        employeeCount: 5,
        emailClass,
        hasEmail: true,
      })

      const { error: insertError } = await admin.from("prospects").insert({
        name: row.company_name || domain,
        org_number: null,
        email,
        email_source: "analyse",
        email_kind: emailClass,
        phone: row.phone,
        website: row.website,
        domain,
        city: row.location,
        source: "analyse",
        status: "kvalifisert",
        // Varme leads hører hjemme hos et menneske, ikke i maskinens kø.
        pipeline_state: "overlevert",
        segment: "handverker",
        trade: row.trade || resolveTrade({ naceDescription: row.detected_trade }),
        contact_policy: contactPolicyFor(gateReasons),
        gate_reasons: gateReasons,
        is_hot: true,
        hot_since: now,
        last_activity_at: now,
        notes: `Kom inn via analysen på proanbud.no${row.submitted_at ? ` ${row.submitted_at.slice(0, 10)}` : ""}. Varmt lead — skal aldri i kald sekvens.`,
      })

      if (insertError) {
        summary.skipped += 1
        if (insertError.code !== "23505") summary.notes.push(insertError.message)
        continue
      }

      summary.created += 1
    }

    return summary
  } catch (error) {
    void logServerError({
      message: "Broen fra analyse-leads feilet",
      level: "warning",
      source: "worker",
      error,
    })
    summary.notes.push(error instanceof Error ? error.message : "Ukjent feil")
    return summary
  }
}
