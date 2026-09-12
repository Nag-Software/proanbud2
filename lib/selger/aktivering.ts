// Aktiveringsscore for prøvebrukere.
//
// En prøveperiode sier ingenting i seg selv. Det som sier noe er om de har
// laget et tilbud og sendt det — for da har de gjort nettopp det de kom for.
// Scoren finnes for å skille «laget 3 tilbud på 2 dager, ring nå» fra «ikke
// innlogget siden dag 1», som krever helt motsatt handling.

import { createAdminClient } from "@/lib/supabase/admin"

export type ActivationSignal = {
  key: string
  label: string
  met: boolean
  weight: number
  detail: string
}

export type Activation = {
  companyId: string
  score: number
  max: number
  /** 0–100, til en enkel søyle. */
  percent: number
  signals: ActivationSignal[]
  /** Hva Casper bør gjøre, i én setning. */
  nextMove: string
  daysSinceSeen: number | null
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

/**
 * Henter aktiveringen for et sett firmaer på én gang.
 *
 * Tåler at en tabell ikke finnes eller er tom — en prøvebruker uten data er
 * et helt normalt utfall, og det er faktisk det mest interessante signalet.
 */
export async function fetchActivation(companyIds: string[]): Promise<Map<string, Activation>> {
  const result = new Map<string, Activation>()
  const ids = companyIds.filter(Boolean)
  if (ids.length === 0) return result

  const admin = createAdminClient()

  // «Sist sett» bor på users (db/32), ikke på companies — et firma er aktivt
  // når et menneske i det har vært innlogget.
  const [offersRes, customersRes, usersRes, tripletexRes, fikenRes] = await Promise.all([
    admin.from("offers").select("company_id, status").in("company_id", ids).limit(2000),
    admin.from("customers").select("company_id").in("company_id", ids).limit(2000),
    admin
      .from("users")
      .select("company_id, last_seen_at")
      .in("company_id", ids)
      .eq("is_active", true)
      .limit(2000),
    admin.from("tripletex_connections").select("company_id").in("company_id", ids).limit(500),
    admin.from("fiken_connections").select("company_id").in("company_id", ids).limit(500),
  ])

  const offersByCompany = new Map<string, { total: number; sent: number }>()
  for (const row of (offersRes.data ?? []) as Array<{ company_id: string; status: string }>) {
    const current = offersByCompany.get(row.company_id) ?? { total: 0, sent: 0 }
    current.total += 1
    if (row.status && row.status !== "utkast" && row.status !== "draft") current.sent += 1
    offersByCompany.set(row.company_id, current)
  }

  const countBy = (rows: Array<{ company_id: string }> | null) => {
    const map = new Map<string, number>()
    for (const row of rows ?? []) map.set(row.company_id, (map.get(row.company_id) ?? 0) + 1)
    return map
  }

  const customers = countBy(customersRes.data as Array<{ company_id: string }> | null)
  const userRows = (usersRes.data ?? []) as Array<{
    company_id: string
    last_seen_at: string | null
  }>
  const seats = countBy(userRows)

  const integrations = new Set([
    ...((tripletexRes.data ?? []) as Array<{ company_id: string }>).map((row) => row.company_id),
    ...((fikenRes.data ?? []) as Array<{ company_id: string }>).map((row) => row.company_id),
  ])

  // Firmaets «sist sett» er den ferskeste av brukerne sine.
  const lastSeenByCompany = new Map<string, string>()
  for (const row of userRows) {
    if (!row.last_seen_at) continue
    const current = lastSeenByCompany.get(row.company_id)
    if (!current || row.last_seen_at > current) lastSeenByCompany.set(row.company_id, row.last_seen_at)
  }

  for (const companyId of ids) {
    const offers = offersByCompany.get(companyId) ?? { total: 0, sent: 0 }
    const customerCount = customers.get(companyId) ?? 0
    const seatCount = seats.get(companyId) ?? 0
    const lastSeen = lastSeenByCompany.get(companyId) ?? null
    const seenDays = daysSince(lastSeen)

    const signals: ActivationSignal[] = [
      {
        key: "tilbud",
        label: "Laget tilbud",
        met: offers.total > 0,
        weight: 2,
        detail: offers.total > 0 ? `${offers.total} tilbud` : "ingen ennå",
      },
      {
        key: "sendt",
        label: "Sendt tilbud",
        met: offers.sent > 0,
        weight: 3,
        detail: offers.sent > 0 ? `${offers.sent} sendt` : "ingen sendt",
      },
      {
        key: "kunder",
        label: "Lagt inn kunder",
        met: customerCount > 0,
        weight: 1,
        detail: `${customerCount} kunder`,
      },
      {
        key: "brukere",
        label: "Invitert flere",
        met: seatCount > 1,
        weight: 1,
        detail: `${seatCount} brukere`,
      },
      {
        key: "regnskap",
        label: "Koblet regnskap",
        met: integrations.has(companyId),
        weight: 2,
        detail: integrations.has(companyId) ? "tilkoblet" : "ikke koblet",
      },
      {
        key: "aktiv",
        label: "Innlogget siste uke",
        met: seenDays !== null && seenDays <= 7,
        weight: 1,
        detail: seenDays === null ? "ukjent" : `sist sett for ${seenDays} d siden`,
      },
    ]

    const max = signals.reduce((sum, signal) => sum + signal.weight, 0)
    const score = signals.reduce((sum, signal) => sum + (signal.met ? signal.weight : 0), 0)

    // Neste handling følger av mønsteret, ikke av tallet. Et høyt tall betyr
    // «ring mens de er varme»; et lavt betyr «de kom aldri i gang».
    let nextMove: string
    if (offers.sent > 0) {
      nextMove = "Har sendt tilbud — ring og spør hvordan det gikk"
    } else if (offers.total > 0) {
      nextMove = "Har laget tilbud, men ikke sendt noe — spør hva som stoppet dem"
    } else if (seenDays !== null && seenDays >= 3) {
      nextMove = `Ikke innlogget på ${seenDays} dager — ring før prøven ryker`
    } else if (seenDays === null) {
      nextMove = "Har aldri logget inn — ring og hjelp dem i gang"
    } else {
      nextMove = "Nylig i gang — la dem prøve litt til, følg opp om to dager"
    }

    result.set(companyId, {
      companyId,
      score,
      max,
      percent: max > 0 ? Math.round((score / max) * 100) : 0,
      signals,
      nextMove,
      daysSinceSeen: seenDays,
    })
  }

  return result
}
