import { listFikenPurchases } from "@/lib/integrations/fiken/connector"
import { getFreshFikenConnection } from "@/lib/integrations/fiken/session"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"
import { mapFikenPurchasesToCosts } from "@/lib/regnskap/costs"
import { replaceProjectAccountingCosts } from "@/lib/regnskap/cost-store"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { osloDateString } from "@/lib/timeforing/oslo-date"

/**
 * Innkjøp ført på prosjekt i Fiken → ProAnbud (`costs.pull`).
 *
 * Fiken har ikke prosjektfilter på innkjøp, så jobben leser alle innkjøp fra en
 * dato og plukker linjene som er merket med et koblet prosjekt. Kall serielt:
 * Fiken tåler én samtidig forespørsel (connectoren serialiserer).
 *
 * Bare innkjøp — ikke fri postering. Fikens bilagsliste inneholder også bilagene
 * innkjøpene selv lager, og å lese begge ville telt samme faktura to ganger.
 */

/** To år holder for alle aktive prosjekter og holder antall sider nede. */
const WINDOW_DAYS = 730
/** Tak på sider per kjøring (100 innkjøp per side). */
const MAX_PAGES = 60

export async function processFikenCostsPull(job: IntegrationJobRow) {
  const connection = await getFreshFikenConnection(job.company_id)
  if (!connection) throw new Error("Fiken connection missing for company")
  if (connection.scope_config?.costs === false) return

  const admin = createAdminClient()
  const links = await fetchAllRows<{ local_id: string; external_id: string | number }>((from, to) =>
    admin
      .from("external_entity_links")
      .select("local_id, external_id")
      .eq("company_id", job.company_id)
      .eq("provider", "fiken")
      .eq("entity_type", "project")
      .order("id", { ascending: true })
      .range(from, to)
  ).catch((error: Error) => {
    throw new Error(`Kunne ikke hente prosjektkoblinger: ${error.message}`)
  })

  // Uten koblede prosjekter kan ingen linje knyttes til noe — spar kallene.
  if (links.length === 0) return

  const projectByFikenId = new Map(links.map((row) => [Number(row.external_id), String(row.local_id)]))
  const windowStart = osloDateString(new Date(Date.now() - WINDOW_DAYS * 86_400_000))

  const purchases: Record<string, unknown>[] = []
  let complete = false
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { items, pageCount } = await listFikenPurchases(connection, { page, dateGe: windowStart })
    purchases.push(...items)
    if (page + 1 >= pageCount || items.length === 0) {
      complete = true
      break
    }
  }

  const rows = mapFikenPurchasesToCosts(purchases, projectByFikenId)
  await replaceProjectAccountingCosts({
    companyId: job.company_id,
    provider: "fiken",
    projectIds: [...new Set(projectByFikenId.values())],
    rows,
    windowStart,
    // Stoppet på sidetaket: kjøp på sidene vi ikke leste er ikke borte, bare ikke sett.
    skipCleanup: !complete,
  })
}
