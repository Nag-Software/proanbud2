"use client"

import * as React from "react"
import Link from "next/link"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import type { ChangeOrder } from "@/lib/tilleggsarbeid/change-order"
import { cn } from "@/lib/utils"

import { EtterfaktureringTab } from "./etterfakturering-tab"
import { FaktureringPanel } from "./fakturering-panel"
import { LonnsomhetTab } from "./lonnsomhet-tab"
import { useProjectFocus, useProjectShell, useProjectTabState } from "./project-tabs-shell"
import TilbudTab from "./tilbud-tab"

/**
 * Seksjonene. Kostnader og budsjett står rett under tilbudet: budsjettet kommer
 * fra tilbudet, og det er der man ser om jobben går som regnet. Verdiene er `?del=`.
 */
const SECTIONS = [
  { value: "sammendrag", label: "Sammendrag" },
  { value: "tilbud", label: "Tilbud" },
  { value: "kostnader", label: "Kostnader og budsjett" },
  { value: "tilleggsarbeid", label: "Tilleggsarbeid" },
  { value: "fakturering", label: "Fakturering" },
] as const

const sectionId = (value: string) => `okonomi-${value}`

type OfferRow = React.ComponentProps<typeof TilbudTab>["offers"][number]

/**
 * Økonomi: alt om penger på én side. Erstatter underfanene Tilbud,
 * Fakturering og Lønnsomhet, som var fire klikk unna hverandre selv om de
 * forteller én historie: tilbud → tillegg → faktura → dekningsbidrag.
 *
 * Nøkkeltallene fra lønnsomheten er sammendraget øverst. Indeksen til venstre
 * (desktop) hopper til seksjonene, og gamle lenker (?tab=tilbud,
 * ?tab=lonnsomhet …) lander på riktig seksjon via `?del=`.
 */
export function OkonomiTab({
  projectId,
  projectName,
  customerName,
  offers,
  changeOrders,
  customerEmail,
  canManage,
  profitability,
  counts,
}: {
  projectId: string
  projectName: string
  customerName: string
  offers: OfferRow[]
  changeOrders: ChangeOrder[] | null
  customerEmail: string | null
  canManage: boolean
  profitability: ProjectProfitability | null
  counts: { offers: number; changeOrders: number }
}) {
  const focus = useProjectFocus("okonomi")
  const { activeTab } = useProjectTabState()
  const { setDel } = useProjectShell()
  // Ekstrajobb-lista øker telleren ved hver endring, og fakturapanelet henter
  // grunnlaget på nytt — ellers kunne en ny ekstrajobb ikke faktureres før
  // siden ble lastet på nytt.
  const [changeSignal, setChangeSignal] = React.useState(0)
  const [current, setCurrent] = React.useState<string>("sammendrag")

  // Gå til seksjonen i ?del= når fanen åpnes eller lenken klikkes igjen.
  React.useEffect(() => {
    if (activeTab !== "okonomi" || !focus.del) return
    const target = document.getElementById(sectionId(focus.del))
    if (!target) return
    const frame = window.requestAnimationFrame(() =>
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    )
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, focus.del, focus.nonce])

  // Marker seksjonen man leser i indeksen: den siste som har passert øvre
  // tredjedel av skjermen. Lytter i capture-fasen fordi appskallet kan ha sin
  // egen scrollcontainer.
  React.useEffect(() => {
    if (activeTab !== "okonomi") return
    const onScroll = () => {
      const threshold = window.innerHeight * 0.3
      let active: string = SECTIONS[0].value
      for (const section of SECTIONS) {
        const element = document.getElementById(sectionId(section.value))
        if (element && element.getBoundingClientRect().top <= threshold) active = section.value
      }
      setCurrent(active)
    }
    onScroll()
    document.addEventListener("scroll", onScroll, { capture: true, passive: true })
    return () => document.removeEventListener("scroll", onScroll, { capture: true })
  }, [activeTab])

  const countFor = (value: string) =>
    value === "tilbud" ? counts.offers : value === "tilleggsarbeid" ? counts.changeOrders : 0

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[176px_minmax(0,1fr)]">
      <nav aria-label="Seksjoner på Økonomi" className="sticky top-4 hidden lg:block">
        <ul className="flex flex-col">
          {SECTIONS.map((section) => (
            <li key={section.value}>
              <a
                href={`#${sectionId(section.value)}`}
                onClick={(event) => {
                  event.preventDefault()
                  setDel(section.value === "sammendrag" ? null : section.value)
                  document
                    .getElementById(sectionId(section.value))
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
                aria-current={current === section.value ? "true" : undefined}
                className={cn(
                  "flex items-center justify-between border-l-2 px-3 py-1.5 text-[13px] transition-colors",
                  current === section.value
                    ? "border-foreground font-semibold text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {section.label}
                {countFor(section.value) > 0 && (
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {countFor(section.value)}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div id={sectionId("sammendrag")} className="min-w-0 scroll-mt-4">
        <LonnsomhetTab
          projectId={projectId}
          canManage={canManage}
          initialData={profitability}
          middle={
            <>
              <section id={sectionId("tilbud")} className="scroll-mt-4 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">Tilbud</h2>
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <Link href={`/nytt-tilbud?projectId=${projectId}`}>
                      <Plus className="size-3.5" />
                      Nytt tilbud
                    </Link>
                  </Button>
                </div>
                <TilbudTab
                  projectId={projectId}
                  projectName={projectName}
                  customerName={customerName}
                  offers={offers}
                />
              </section>
            </>
          }
          detailsHeading={
            <h2 id={sectionId("kostnader")} className="scroll-mt-4 pt-2 text-base font-semibold">
              Kostnader og budsjett
            </h2>
          }
          afterDetails={
            <>
              <section id={sectionId("tilleggsarbeid")} className="scroll-mt-4">
                <EtterfaktureringTab
                  projectId={projectId}
                  canManage={canManage}
                  initialItems={changeOrders}
                  customerEmail={customerEmail}
                  onChanged={() => setChangeSignal((n) => n + 1)}
                />
              </section>

              <section id={sectionId("fakturering")} className="scroll-mt-4">
                <FaktureringPanel projectId={projectId} canManage={canManage} refreshSignal={changeSignal} />
              </section>
            </>
          }
        />
      </div>
    </div>
  )
}
