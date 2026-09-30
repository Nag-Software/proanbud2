"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

/**
 * Frisk opp siden som står fremme når brukeren kommer tilbake til fanen (eller
 * appen) etter en stund borte.
 *
 * Tidligere skjedde dette ved en tilfeldighet: supabase-js sender SIGNED_IN
 * hver gang fanen blir synlig, og AuthProvider kjørte router.refresh() på det
 * — ved HVERT fanebytte, også etter to sekunder. Nå er det bevisst, og bare
 * når siden kan ha blitt utdatert: etter minst ett minutt borte.
 */
const MIN_HIDDEN_MS = 60_000

export function RefreshOnReturn() {
  const router = useRouter()

  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now()
        return
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= MIN_HIDDEN_MS) router.refresh()
      hiddenAt = null
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [router])

  return null
}
