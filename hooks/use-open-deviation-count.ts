"use client"

import * as React from "react"

import { useRoleContext } from "@/components/role-provider"
import { OPEN_DEVIATION_STATUSES } from "@/lib/hms/constants"
import { createClient } from "@/lib/supabase/client"

/**
 * Antall åpne avvik for sidebar-merket.
 *
 * Telles rett mot databasen med samme innloggede klient og samme RLS som
 * avvikssidene bruker, som en ren count (ingen rader overføres). Tidligere gikk
 * dette via en server action som hentet ALLE bedriftens avvik for å telle dem
 * i JavaScript — én serverless-kjøring og en full tabell per sidelasting.
 */
export function useOpenDeviationCount() {
  const { companyId } = useRoleContext()
  const [count, setCount] = React.useState(0)

  React.useEffect(() => {
    if (!companyId) return
    let cancelled = false
    createClient()
      .from("deviations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", OPEN_DEVIATION_STATUSES)
      .then(({ count: openCount, error }) => {
        if (!cancelled) setCount(error ? 0 : openCount ?? 0)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  return companyId ? count : 0
}
