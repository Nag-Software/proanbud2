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

  while (page < pageCount && page < MAX_PAGES) {
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

  // Advance the cursor to today (date granularity; we re-poll from here next run).
  await admin
    .from("fiken_connections")
    .update({ last_payment_poll_date: new Date().toISOString().slice(0, 10) })
    .eq("company_id", connection.company_id)

  return { scanned, newlyPaid }
}
