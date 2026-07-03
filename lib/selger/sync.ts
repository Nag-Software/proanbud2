// Trial-broen: selvregistrerte firmaer skal dukke opp som kort i salgspipelinen
// uten at signup-flyten vet noe om selgerverktøyet. Kjøres lazy ved pipeline-load:
// alle firmaer med billing trialing/active/past_due som mangler prospect-kobling
// får (eller kobles til) en prospect-rad. Prospect-raden er den kanoniske «dealen»
// — all drag-drop, alle oppgaver og hele tidslinjen henger på den.

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"

type AdminClient = ReturnType<typeof createAdminClient>

type CompanyForSync = {
  id: string
  name: string
  org_number: string | null
  email: string | null
  phone: string | null
  billingStatus: string
}

function targetStatusFor(billingStatus: string): "trial" | "kunde" {
  return billingStatus === "trialing" ? "trial" : "kunde"
}

/**
 * Sørg for at hvert aktivt/prøvende firma har nøyaktig én prospect-rad.
 *
 * - Firma MED org.nr: upsert på org_number — kobler et eksisterende kaldt
 *   prospect hvis selgeren allerede hadde firmaet i pipelinen (ønsket kollisjon).
 * - Firma UTEN org.nr: insert med org_number NULL, idempotent via den partielle
 *   unike indeksen på matched_company_id (db/66).
 * - Status settes trialing→'trial', active/past_due→'kunde' — men degraderes
 *   aldri (et vunnet/tapt lead ryker ikke tilbake til trial).
 *
 * Best effort: feiler synken, viser pipelinen fortsatt det den har.
 */
export async function ensureProspectsForCompanies(admin: AdminClient): Promise<void> {
  try {
    const { data: billingRows, error } = await admin
      .from("company_billing")
      .select("company_id, status, companies(id, name, org_number, email, phone)")
      .in("status", ["trialing", "active", "past_due"])

    if (error || !billingRows?.length) return

    const companies: CompanyForSync[] = []
    for (const row of billingRows) {
      const company = (Array.isArray(row.companies) ? row.companies[0] : row.companies) as {
        id: string
        name: string
        org_number: string | null
        email: string | null
        phone: string | null
      } | null
      if (!company) continue
      companies.push({
        id: company.id,
        name: company.name,
        org_number: company.org_number?.trim() || null,
        email: company.email?.trim().toLowerCase() || null,
        phone: company.phone?.trim() || null,
        billingStatus: row.status as string,
      })
    }
    if (companies.length === 0) return

    // Hvilke firmaer er allerede koblet?
    const { data: linked } = await admin
      .from("prospects")
      .select("matched_company_id")
      .in("matched_company_id", companies.map((c) => c.id))
    const linkedIds = new Set((linked ?? []).map((r) => r.matched_company_id))

    const unlinked = companies.filter((c) => !linkedIds.has(c.id))
    if (unlinked.length === 0) return

    const now = new Date().toISOString()

    for (const company of unlinked) {
      const status = targetStatusFor(company.billingStatus)

      if (company.org_number) {
        // Finnes et kaldt prospect med samme org.nr? Da er dette den ønskede
        // koblingen: selgerens lead ble kunde/trial av seg selv.
        const { data: existing } = await admin
          .from("prospects")
          .select("id, status")
          .eq("org_number", company.org_number)
          .maybeSingle()

        if (existing) {
          const updates: Record<string, unknown> = {
            matched_company_id: company.id,
            is_existing_customer: true,
            updated_at: now,
          }
          // Aldri degrader et lukket lead; ellers følg billing.
          if (existing.status !== "kunde" && existing.status !== "tapt") {
            updates.status = status
            updates.stage_entered_at = now
          }
          await admin.from("prospects").update(updates).eq("id", existing.id)
          continue
        }
      }

      // Ingen eksisterende rad — opprett bro-raden. Ved kappløp tar den unike
      // indeksen på matched_company_id (eller org_number) støyten; feilen svelges.
      const { error: insertError } = await admin.from("prospects").insert({
        org_number: company.org_number,
        name: company.name,
        email: company.email,
        phone: company.phone,
        source: "signup",
        enrichment_status: company.email || company.phone ? "enriched" : "no_contact",
        status,
        matched_company_id: company.id,
        is_existing_customer: true,
        last_activity_at: now,
        stage_entered_at: now,
      })
      if (insertError && insertError.code !== "23505") {
        console.error("[selger/sync] kunne ikke opprette bro-prospect", insertError)
      }
    }
  } catch (error) {
    await logServerError({
      message: "ensureProspectsForCompanies: trial-bro-synk feilet",
      error,
      level: "warning",
      source: "server",
      route: "lib/selger/sync.ts",
    })
  }
}
