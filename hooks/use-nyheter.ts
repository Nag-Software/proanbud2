"use client"

import * as React from "react"

import { useAuth } from "@/components/auth-provider"
import { useUserRole } from "@/hooks/use-user-role"
import { aktuelleNyheter, type Nyhet } from "@/lib/nyheter"

const LEST_PREFIX = "pa_nyheter_lest:"
const ENDRET = "pa:nyheter-endret"

function lesLest(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(LEST_PREFIX + userId)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

function skrivLest(userId: string, ider: string[]) {
  try {
    window.localStorage.setItem(LEST_PREFIX + userId, JSON.stringify(ider))
  } catch {
    // Blokkert lagring: nyheten vises bare som ulest igjen neste gang.
  }
  window.dispatchEvent(new Event(ENDRET))
}

const abonner = (lytter: () => void) => {
  window.addEventListener(ENDRET, lytter)
  window.addEventListener("storage", lytter)
  return () => {
    window.removeEventListener(ENDRET, lytter)
    window.removeEventListener("storage", lytter)
  }
}

export type NyhetMedStatus = Nyhet & { lest: boolean }

/**
 * Nyhetene i varselbjella, med lest-status for denne brukeren. Delt mellom
 * sidemenyen og mobilhjemmet via et window-event, så begge viser det samme.
 */
export function useNyheter() {
  const { user } = useAuth()
  const { isWorker, roleKnown } = useUserRole()
  const userId: string | null = user?.id ?? null

  const lestRaw = React.useSyncExternalStore(
    abonner,
    () => (userId ? (window.localStorage.getItem(LEST_PREFIX + userId) ?? "[]") : "[]"),
    () => "[]"
  )

  const nyheter = React.useMemo<NyhetMedStatus[]>(() => {
    if (!userId || !roleKnown) return []
    const lest = new Set(lesLest(userId))
    return aktuelleNyheter({ erHandverker: isWorker }).map((nyhet) => ({ ...nyhet, lest: lest.has(nyhet.id) }))
    // lestRaw er med så lista oppdateres når noe markeres som lest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorker, lestRaw, roleKnown, userId])

  const merkLest = React.useCallback(
    (id: string) => {
      if (!userId) return
      const lest = lesLest(userId)
      if (!lest.includes(id)) skrivLest(userId, [...lest, id])
    },
    [userId]
  )

  const merkAlleLest = React.useCallback(() => {
    if (!userId) return
    const lest = new Set(lesLest(userId))
    for (const nyhet of nyheter) lest.add(nyhet.id)
    skrivLest(userId, [...lest])
  }, [nyheter, userId])

  return { nyheter, uleste: nyheter.filter((nyhet) => !nyhet.lest).length, merkLest, merkAlleLest }
}
