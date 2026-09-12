// Trakt per segment.
//
// Et segment er en påstand om hvem vi bør snakke med. Trakten er måten å se om
// påstanden holder: går 40 funnet inn og null svar ut, er det ikke teksten som
// er feil — det er målgruppen.

import { createAdminClient } from "@/lib/supabase/admin"
import { SEGMENTS, type SegmentKey } from "@/lib/outreach/segments"
import type { MachineFunnel } from "@/lib/selger/godkjenning"

export type SegmentStats = {
  key: SegmentKey
  label: string
  naeringskoder: string[]
  ansatte: string
  funnel: MachineFunnel
  /** Menneskesteg. */
  sendt: number
  svar: number
  positive: number
  dialog: number
  kunder: number
  /** Andel av sendte som svarte. Null før det finnes nok data. */
  svarrate: number | null
  cost_usd: number
}

const EMPTY_FUNNEL: MachineFunnel = {
  kilde: 0,
  venter_research: 0,
  kvalifisert: 0,
  til_godkjenning: 0,
  i_sekvens: 0,
  avsluttet: 0,
  for_tynn: 0,
  kun_telefon: 0,
  diskvalifisert: 0,
}

export async function fetchSegmentStats(): Promise<SegmentStats[]> {
  const admin = createAdminClient()
  const out: SegmentStats[] = []

  for (const segment of Object.values(SEGMENTS)) {
    const funnel = { ...EMPTY_FUNNEL }
    let sendt = 0
    let svar = 0
    let positive = 0
    let dialog = 0
    let kunder = 0
    let cost = 0

    try {
      const [prospectsRes, messagesRes, repliesRes, researchRes] = await Promise.all([
        admin.from("prospects").select("pipeline_state, status").eq("segment", segment.key).limit(5000),
        admin
          .from("outreach_messages")
          .select("id, prospects!inner(segment)")
          .eq("status", "sendt")
          .eq("prospects.segment", segment.key)
          .limit(5000),
        admin
          .from("inbound_emails")
          .select("classification, prospects!inner(segment)")
          .eq("prospects.segment", segment.key)
          .limit(5000),
        admin
          .from("prospect_research")
          .select("cost_usd, prospects!inner(segment)")
          .eq("prospects.segment", segment.key)
          .limit(5000),
      ])

      for (const row of (prospectsRes.data ?? []) as Array<{
        pipeline_state: string | null
        status: string | null
      }>) {
        const state = row.pipeline_state
        if (state && state in funnel) funnel[state as keyof MachineFunnel] += 1
        if (row.status === "dialog" || row.status === "demo") dialog += 1
        if (row.status === "kunde") kunder += 1
      }

      sendt = (messagesRes.data ?? []).length

      for (const row of (repliesRes.data ?? []) as Array<{ classification: string | null }>) {
        // Autosvar er ikke et svar fra et menneske, og skal ikke pynte på raten.
        if (row.classification === "autosvar" || row.classification === "ikke_levert") continue
        svar += 1
        if (row.classification === "positiv") positive += 1
      }

      cost = ((researchRes.data ?? []) as Array<{ cost_usd: number | null }>).reduce(
        (sum, row) => sum + Number(row.cost_usd ?? 0),
        0,
      )
    } catch {
      // Migrasjonene er ikke kjørt ennå — vis segmentet med nuller.
    }

    out.push({
      key: segment.key,
      label: segment.label,
      naeringskoder: segment.naeringskoder,
      ansatte: `${segment.fraAntallAnsatte}–${segment.tilAntallAnsatte}`,
      funnel,
      sendt,
      svar,
      positive,
      dialog,
      kunder,
      svarrate: sendt >= 10 ? svar / sendt : null,
      cost_usd: cost,
    })
  }

  return out
}
