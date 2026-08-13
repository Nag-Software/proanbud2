"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ClipboardCheck, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ChecklistSummary } from "@/lib/ks/types"
import type { DeviationWithRelations } from "@/lib/hms/types"

import AvvikTab from "./avvik-tab"
import KsTab from "./ks-tab"
import { aliasSubTab } from "./project-tab-aliases"
import { useProjectSubTabNavigation } from "./project-tabs-shell"

export const KVALITET_SUB_TABS = ["sjekklister", "avvik"] as const
export type KvalitetSubTab = (typeof KVALITET_SUB_TABS)[number]

type Props = {
  projectId: string
  checklists: ChecklistSummary[]
  deviations: DeviationWithRelations[]
  /** KS er Proff-funksjon og skjules for håndverkere. */
  showChecklists: boolean
  /** Avvik er Proff-funksjon, men synlig for alle roller. */
  showDeviations: boolean
}

/**
 * «KS & Avvik» — kvalitetssikring og avvik i én fane. Begge deler er samme
 * arbeid (en sjekkliste som slår feil ender som et avvik), og som separate
 * faner tvang de frem to klikk for å se hele bildet.
 *
 * Underfanen ligger i ?sub=, og de gamle lenkene (?tab=ks / ?tab=avvik) mappes
 * hit via PROJECT_TAB_ALIASES.
 */
export default function KvalitetTab({
  projectId,
  checklists,
  deviations,
  showChecklists,
  showDeviations,
}: Props) {
  const searchParams = useSearchParams()
  const setSubTab = useProjectSubTabNavigation()

  const options = React.useMemo(
    () =>
      [
        showChecklists
          ? {
              value: "sjekklister" as const,
              label: "Sjekklister",
              icon: ClipboardCheck,
              count: checklists.length,
            }
          : null,
        showDeviations
          ? {
              value: "avvik" as const,
              label: "Avvik",
              icon: TriangleAlert,
              count: deviations.length,
            }
          : null,
      ].filter((option) => option !== null),
    [showChecklists, showDeviations, checklists.length, deviations.length]
  )

  const fallback: KvalitetSubTab = options[0]?.value ?? "sjekklister"
  const availableValues = options.map((option) => option.value)
  const subParam = searchParams.get("sub")
  const tabParam = searchParams.get("tab")

  const [active, setActive] = React.useState<KvalitetSubTab>(() => {
    const candidate = subParam ?? aliasSubTab(tabParam)
    return availableValues.find((value) => value === candidate) ?? fallback
  })

  // Dyplenker og navigateToTab("avvik") fra Oversikt skriver ?sub= — plukk det
  // opp også etter at fanen er montert (den holdes i live av ProjectTabPanel).
  React.useEffect(() => {
    if (!subParam) return
    const next = availableValues.find((value) => value === subParam)
    if (next) setActive(next)
    // availableValues er utledet av props som sjelden endrer seg; ?sub= er
    // signalet vi faktisk reagerer på.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subParam])

  // Mister vi tilgangen til den valgte underfanen (rolle-/planbytte), fall
  // tilbake til den som fortsatt finnes.
  React.useEffect(() => {
    if (options.length > 0 && !availableValues.includes(active)) {
      setActive(fallback)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.length, active, fallback])

  const [visited, setVisited] = React.useState<ReadonlySet<KvalitetSubTab>>(
    () => new Set([active])
  )

  React.useEffect(() => {
    setVisited((prev) => {
      if (prev.has(active)) return prev
      const next = new Set(prev)
      next.add(active)
      return next
    })
  }, [active])

  function handleSelect(value: KvalitetSubTab) {
    setActive(value)
    setSubTab(value)
  }

  if (options.length === 0) return null

  const showSwitcher = options.length > 1

  return (
    <div className="space-y-4">
      {showSwitcher && (
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-card p-0.5">
          {options.map(({ value, label, icon: Icon, count }) => (
            <button
              key={value}
              type="button"
              onClick={() => handleSelect(value)}
              aria-pressed={active === value}
              className={cn(
                "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              {count > 0 && (
                <span
                  className={cn(
                    "tabular-nums",
                    active === value ? "text-primary-foreground/80" : "text-muted-foreground/80"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Samme lat keep-alive som ProjectTabPanel: monteres først når underfanen
          åpnes (sjekklistegalleriet henter bilder klientsiden), og blir så
          liggende skjult slik at bytte frem og tilbake er umiddelbart. */}
      {showChecklists && visited.has("sjekklister") && (
        <div className={cn(active !== "sjekklister" && "hidden")}>
          <KsTab projectId={projectId} checklists={checklists} />
        </div>
      )}
      {showDeviations && visited.has("avvik") && (
        <div className={cn(active !== "avvik" && "hidden")}>
          <AvvikTab projectId={projectId} deviations={deviations} />
        </div>
      )}
    </div>
  )
}
