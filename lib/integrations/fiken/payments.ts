import { createAdminClient } from "@/lib/supabase/admin"
import { listFikenSettledInvoices } from "@/lib/integrations/fiken/connector"
import { getFikenLocalByExternal, upsertFikenLink } from "@/lib/integrations/fiken/jobs"
import { fikenInvoiceUrl } from "@/lib/integrations/fiken/urls"
import type { FikenConnectionRow, FikenInvoiceRead } from "@/lib/integrations/fiken/types"

const MAX_PAGES = 50

function invoiceExternalId(invoice: FikenInvoiceRead): number | null {
  const id = Number(invoice.invoiceId)
  return Number.isFinite(id) ? id : null
}

/**
 * Poll Fiken for settled (paid) invoices and flip the matching links to 'paid'.
 *
 * Fiken has no webhooks. We poll GET /invoices?settled=true and key off invoiceId,
 * which we already persist in external_entity_links — no sale→invoice mapping needed.
 * `lastModified` has DATE-ONLY granularity, so we re-poll from last_payment_poll_date
 * each run and upsert-by-id. The on-paid side effect (mark offer accepted) only fires
 * on the pending->paid TRANSITION, never on every poll that re-sees a settled invoice.
 */
export async function pollFikenPayments(
  connection: FikenConnectionRow
): Promise<{ scanned: number; newlyPaid: number }> {
  const admin = createAdminClient()
  const sinceDate = connection.last_payment_poll_date
    ? String(connection.last_payment_poll_date).slice(0, 10)
    : null

  let scanned = 0
  let newlyPaid = 0
  let page = 0
  let pageCount = 1
  let truncated = false

  while (page < pageCount) {
    if (page >= MAX_PAGES) {
      // More settled invoices than we read in one run. We must NOT advance the cursor
      // (see below) or the unscanned pages would be skipped forever.
      truncated = true
      break
    }
    const { items, pageCount: total } = await listFikenSettledInvoices(connection, { sinceDate, page })
    pageCount = total

    for (const invoice of items) {
      scanned += 1
      const externalId = invoiceExternalId(invoice)
      if (!externalId) continue

      const link = await getFikenLocalByExternal({
        companyId: connection.company_id,
        entityType: "invoice",
        externalId,
      })

      if (!link?.local_id) continue
      // Transition guard: only act when not already marked paid.
      if (link.sync_status === "paid") continue

      const offerId = String(link.local_id)

      await upsertFikenLink({
        companyId: connection.company_id,
        entityType: "invoice",
        localId: offerId,
        externalId,
        syncStatus: "paid",
        externalUrl:
          link.external_url ||
          (connection.fiken_company_slug ? fikenInvoiceUrl(connection.fiken_company_slug, externalId) : null),
      })

      await admin
        .from("offers")
        .update({ status: "accepted", updated_at: new Date().toISOString() })
        .eq("id", offerId)
        .eq("company_id", connection.company_id)

      newlyPaid += 1
    }

    page += 1
  }

  // Only advance the cursor when we actually scanned the WHOLE result set. If the run
  // was truncated at MAX_PAGES, jumping the cursor to today would permanently skip the
  // settled invoices we never read (they'd never transition to 'paid', and their offers
  // would never be marked accepted). Leaving the cursor means the next run re-scans the
  // same window (cheap — the transition guard skips already-paid links).
  if (truncated) {
    console.warn(
      `[fiken payments] truncated at ${MAX_PAGES} pages for company ${connection.company_id}; ` +
        `cursor left at ${sinceDate ?? "beginning"} to avoid skipping unscanned settled invoices.`
    )
  } else {
    await admin
      .from("fiken_connections")
      .update({ last_payment_poll_date: new Date().toISOString().slice(0, 10) })
      .eq("company_id", connection.company_id)
  }

  return { scanned, newlyPaid }
}
