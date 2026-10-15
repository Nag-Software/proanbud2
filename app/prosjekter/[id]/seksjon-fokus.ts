"use client"

import * as React from "react"

import { useProjectFocus, useProjectTabState } from "./project-tabs-shell"

/**
 * Ruller til seksjonen i `?del=` når fanen åpnes, eller når en lenke dit
 * klikkes igjen (som Økonomi gjorde). `idFor` gir element-id-en for en del.
 */
export function useSeksjonFokus(tab: string, idFor: (del: string) => string) {
  const focus = useProjectFocus(tab)
  const { activeTab } = useProjectTabState()
  const idForRef = React.useRef(idFor)
  React.useEffect(() => {
    idForRef.current = idFor
  })

  React.useEffect(() => {
    if (activeTab !== tab || !focus.del) return
    const target = document.getElementById(idForRef.current(focus.del))
    if (!target) return
    const frame = window.requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }))
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, tab, focus.del, focus.nonce])
}
