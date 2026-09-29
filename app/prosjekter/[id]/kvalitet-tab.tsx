"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, Plus, Search } from "lucide-react"

import { ChecklistCard } from "@/components/ks/checklist-card"
import { TemplateLibraryDialog } from "@/components/ks/template-library-dialog"
import { DeviationListItem } from "@/components/hms/deviation-badges"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { DeviationWithRelations } from "@/lib/hms/types"
import type { ChecklistSummary } from "@/lib/ks/types"
import { cn } from "@/lib/utils"

import { useProjectFocus, useProjectIntent, useProjectShell } from "./project-tabs-shell"

type Filter = "alle" | "venter" | "sjekklister" | "avvik"

type Props = {
  projectId: string
  checklists: ChecklistSummary[]
  deviations: DeviationWithRelations[]
  /** KS er Proff-funksjon. Håndverkere fyller ut, ledere legger også til sjekklister. */
  showChecklists: boolean
  /** Avvik er Proff-funksjon, men synlig for alle roller. */
  showDeviations: boolean
  /** Kan legge til sjekklister fra malbiblioteket (ledere). */
  canManageChecklists?: boolean
}

type Row =
  | { kind: "sjekkliste"; id: string; needsAction: boolean; date: number; checklist: ChecklistSummary }
  | { kind: "avvik"; id: string; needsAction: boolean; date: number; deviation: DeviationWithRelations }

const FILTERS: Filter[] = ["alle", "venter", "sjekklister", "avvik"]
const isFilter = (value: string | null): value is Filter => !!value && (FILTERS as string[]).includes(value)

/**
 * «KS og avvik»: sjekklister og avvik i ÉN liste. En sjekkliste som slår feil
 * ender som et avvik, så det er samme arbeid. Før lå de bak hver sin bryter
 * inne i en underfane (Arbeid → KS & Avvik → Avvik).
 *
 * Det som venter på noen (åpne avvik, sjekklister som ikke er ferdige) står
 * først. Filteret ligger i `?del=`, så gamle lenker (?tab=avvik, ?tab=ks)
 * lander på riktig filter.
 */
export default function KvalitetTab({
  projectId,
  checklists,
  deviations,
  showChecklists,
  showDeviations,
  canManageChecklists = true,
}: Props) {
  const router = useRouter()
  const focus = useProjectFocus("kvalitet")
  const { setDel } = useProjectShell()
  const [search, setSearch] = React.useState("")
  const [libraryOpen, setLibraryOpen] = React.useState(false)

  const canAddChecklist = showChecklists && canManageChecklists
  useProjectIntent("ny-sjekkliste", () => {
    if (canAddChecklist) setLibraryOpen(true)
  })

  const filter: Filter = isFilter(focus.del) ? focus.del : "alle"

  const rows = React.useMemo<Row[]>(() => {
    const list: Row[] = []
    if (showChecklists) {
      for (const checklist of checklists) {
        list.push({
          kind: "sjekkliste",
          id: checklist.id,
          needsAction: checklist.status !== "completed",
          date: new Date(checklist.updated_at || checklist.created_at).getTime(),
          checklist,
        })
      }
    }
    if (showDeviations) {
      for (const deviation of deviations) {
        list.push({
          kind: "avvik",
          id: deviation.id,
          needsAction: deviation.status === "open",
          date: new Date(deviation.created_at).getTime(),
          deviation,
        })
      }
    }
    return list.sort((a, b) => {
      if (a.needsAction !== b.needsAction) return a.needsAction ? -1 : 1
      // Blant det som venter står åpne avvik over uferdige sjekklister.
      if (a.needsAction && a.kind !== b.kind) return a.kind === "avvik" ? -1 : 1
      return b.date - a.date
    })
  }, [checklists, deviations, showChecklists, showDeviations])

  const counts = {
    alle: rows.length,
    venter: rows.filter((row) => row.needsAction).length,
    sjekklister: rows.filter((row) => row.kind === "sjekkliste").length,
    avvik: rows.filter((row) => row.kind === "avvik").length,
  }

  const needle = search.trim().toLowerCase()
  const visibleRows = rows.filter((row) => {
    if (filter === "venter" && !row.needsAction) return false
    if (filter === "sjekklister" && row.kind !== "sjekkliste") return false
    if (filter === "avvik" && row.kind !== "avvik") return false
    if (!needle) return true
    const haystack =
      row.kind === "sjekkliste"
        ? row.checklist.name
        : `${row.deviation.title} ${row.deviation.description} ${row.deviation.reference_number}`
    return haystack.toLowerCase().includes(needle)
  })

  const filterOptions: Array<{ value: Filter; label: string }> = [
    { value: "alle", label: "Alle" },
    { value: "venter", label: "Venter" },
    ...(showChecklists && showDeviations
      ? ([
          { value: "sjekklister", label: "Sjekklister" },
          { value: "avvik", label: "Avvik" },
        ] as const)
      : []),
  ]

  const title =
    showChecklists && showDeviations ? "KS og avvik" : showChecklists ? "Sjekklister" : "Avvik"

  const summary = [
    counts.venter > 0 ? `${counts.venter} venter` : null,
    showChecklists ? `${counts.sjekklister} ${counts.sjekklister === 1 ? "sjekkliste" : "sjekklister"}` : null,
    showDeviations ? `${counts.avvik} avvik` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  function handleAdded(checklistId: string) {
    router.refresh()
    router.push(`/prosjekter/${projectId}/ks/${checklistId}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showDeviations && deviations.length > 0 && (
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/avvik/export?format=csv&projectId=${projectId}`} download>
                <Download className="size-4" />
                Eksporter avvik
              </a>
            </Button>
          )}
          {canAddChecklist && (
            <Button variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
              <Plus className="size-4" />
              Legg til sjekkliste
            </Button>
          )}
          {showDeviations && (
            <Button size="sm" asChild>
              <Link href={`/avvik/ny?projectId=${projectId}`}>
                <Plus className="size-4" />
                Meld avvik
              </Link>
            </Button>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
            {filterOptions.map((option) => {
              const active = filter === option.value
              const count = counts[option.value]
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDel(option.value === "alle" ? null : option.value)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-[13px] font-medium transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                  <span className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground/80")}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Søk i sjekklister og avvik"
              aria-label="Søk i sjekklister og avvik"
              className="pl-9"
            />
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {canAddChecklist
              ? "Ingen sjekklister eller avvik ennå. Legg til en sjekkliste fra malbiblioteket, så blir ingenting glemt."
              : showChecklists
                ? "Ingen sjekklister eller avvik på prosjektet ennå. Lederen legger til sjekklistene."
                : "Ingen avvik registrert på dette prosjektet."}
          </p>
          {canAddChecklist && (
            <Button className="mt-4" onClick={() => setLibraryOpen(true)}>
              <Plus className="size-4" />
              Velg mal
            </Button>
          )}
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {filter === "venter" && !needle
            ? "Ingenting venter. Alle sjekklister er fullført og alle avvik er lukket."
            : "Ingen treff."}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map((row) =>
            row.kind === "sjekkliste" ? (
              <ChecklistCard key={`s-${row.id}`} checklist={row.checklist} projectId={projectId} />
            ) : (
              <DeviationListItem key={`a-${row.id}`} deviation={row.deviation} showProject={false} />
            )
          )}
        </div>
      )}

      {canAddChecklist && (
        <TemplateLibraryDialog
          open={libraryOpen}
          onOpenChange={setLibraryOpen}
          projectId={projectId}
          onAdded={handleAdded}
        />
      )}
    </div>
  )
}
