# Prosjekter: Kort ↔ Kanban-toggle — implementeringsplan

**Status:** godkjent retning, ikke implementert. Bygg når du er klar.

## Mål
På `/prosjekter`: legg til en **Kort / Kanban**-toggle for *Aktive prosjekter*.
- **Kort** = dagens visning, **helt uendret** (samme `ProjectCard`, samme grid).
- **Kanban** = ny statustavle, som mockup **C** (`docs/prosjekter-mockups/mock-C-statustavle.png`).
- *Tidligere prosjekter* (arkiv-tabellen) er uendret og vises i begge visninger.

Mockups + generator ligger i `docs/prosjekter-mockups/` (`mockups.html`, `shoot.js`, 5 PNG-er). Regenerer: `node docs/prosjekter-mockups/shoot.js`.

## Arkitektur-beslutninger
- **Persistens:** lagre valg i URL `?view=kanban` via `window.history.replaceState` (ingen RSC-refetch — bytte er rent presentasjonelt, data er allerede på klienten). Server leser `searchParams.view` og setter `initialView`, så reload/bokmerke gjenoppretter visningen uten flash.
- **DnD:** gjenbruk `@hello-pangea/dnd` (allerede i prosjektet, driver oppgave-tavla). Lazy-load tavla med `next/dynamic({ ssr:false })` slik at dnd-bundelen ikke havner i hovedruten — samme mønster som `app/prosjekter/[id]/oppgaver-tab.tsx:42`.
- **Status-endring ved drag:** optimistisk oppdatering + `updateProjectAction(id, { status })` + rollback (kopier `handleDragEnd` fra `oppgaver-tab.tsx:175`). Kun de 3 aktive kolonnene (planning/active/on_hold) er droppable.
- **Ytelse:** IKKE hent oppgave-/avvik-tall til kanban-kortene. Hovedlista er bevisst trimmet (se kommentar i `page.tsx`); grupperte tall krever RPC. Kanban-kort bruker samme data som dagens kort (navn, kode, kunde, periode, status). Metrics = evt. senere follow-up.

## Gjenbrukspunkter (verifisert)
- `updateProjectAction(projectId, { status })` — `app/prosjekter/actions.ts:514`. `status` er whitelisted (`EDITABLE_PROJECT_FIELDS`, actions.ts:503).
- `ProjectStatusFooter` (statuslinjen) — `app/prosjekter/project-status-footer.tsx`. Gjenbrukes på kanban-kortet.
- `getStatusConfig`, `getProjectCode/Customer/Period`, `ProjectRow` — `app/prosjekter/project-utils.ts`.
- `useConfirm()` — `@/components/ui/confirm-dialog`; `ConfirmProvider` er allerede montert i `app/layout.tsx:72`.
- Dropdown-submeny tilgjengelig: `DropdownMenuSub/SubTrigger/SubContent/Separator/Label`.
- Ikoner (lucide): `LayoutGrid`, `Columns3`, `MoreVertical`, `Archive`.

## Filer

### 1) NY: `app/prosjekter/active-projects.tsx` (client)
Holder toggle-state, rendrer uendret kort-grid for `kort`, lazy-laster tavla for `kanban`, synker `?view` til URL.
```tsx
"use client"
import * as React from "react"
import dynamic from "next/dynamic"
import { Columns3, LayoutGrid } from "lucide-react"
import { cn } from "@/lib/utils"
import { ProjectCard } from "./project-card"
import type { ClientOption } from "./ny/components/client-autocomplete"
import type { ProjectRow } from "./project-utils"

const ProjectKanbanBoard = dynamic(() => import("./project-kanban-board"), {
  ssr: false,
  loading: () => (
    <div className="grid gap-3 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/20" />
      ))}
    </div>
  ),
})

type ProjectsView = "kort" | "kanban"

export function ActiveProjects({
  projects, customers, initialView,
}: { projects: ProjectRow[]; customers: ClientOption[]; initialView: ProjectsView }) {
  const [view, setView] = React.useState<ProjectsView>(initialView)
  const changeView = React.useCallback((next: ProjectsView) => {
    setView(next)
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      if (next === "kanban") url.searchParams.set("view", "kanban")
      else url.searchParams.delete("view")
      window.history.replaceState(null, "", url.toString())
    }
  }, [])

  return (
    <div className="space-y-2 sm:space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">Aktive prosjekter</h2>
          <span className="text-xs text-muted-foreground">{projects.length} prosjekter</span>
        </div>
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-card p-0.5">
          {([["kort","Kort",LayoutGrid],["kanban","Kanban",Columns3]] as const).map(([val,label,Icon]) => (
            <button key={val} type="button" onClick={() => changeView(val)} aria-pressed={view===val}
              className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                view===val ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center" style={{ borderRadius: 5 }}>
          <p className="text-sm text-muted-foreground">Ingen aktive prosjekter funnet.</p>
        </div>
      ) : view === "kanban" ? (
        <ProjectKanbanBoard projects={projects} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5" style={{ borderRadius: 5 }}>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} customers={customers} />
          ))}
        </div>
      )}
    </div>
  )
}
```

### 2) NY: `app/prosjekter/project-kanban-board.tsx` (client, default export)
```tsx
"use client"
import * as React from "react"
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd"
import { toast } from "sonner"
import { reportClientError } from "@/lib/errors/client"
import { cn } from "@/lib/utils"
import { updateProjectAction } from "./actions"
import { ProjectKanbanCard } from "./project-kanban-card"
import { getStatusConfig, type ProjectRow } from "./project-utils"

const COLUMNS = [
  { value: "planning", label: "Planlegges" },
  { value: "active", label: "Under utførelse" },
  { value: "on_hold", label: "På pause" },
] as const
const TOP_BORDER: Record<string, string> = {
  planning: "var(--tone-warning)", active: "var(--accent)", on_hold: "var(--tone-neutral)",
}

export default function ProjectKanbanBoard({ projects: initial }: { projects: ProjectRow[] }) {
  const [projects, setProjects] = React.useState(initial)
  React.useEffect(() => { setProjects(initial) }, [initial])

  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result
    if (!destination || source.droppableId === destination.droppableId) return
    const newStatus = destination.droppableId
    const snapshot = projects
    setProjects((prev) => prev.map((p) => (p.id === draggableId ? { ...p, status: newStatus } : p)))
    try {
      await updateProjectAction(draggableId, { status: newStatus })
    } catch (error) {
      console.error("Kunne ikke flytte prosjekt", error)
      reportClientError(error, { context: { action: "flytte prosjekt (kanban)", projectId: draggableId } })
      setProjects(snapshot)
      toast.error("Kunne ikke flytte prosjektet – prøv igjen")
    }
  }
  const onRemoved = React.useCallback((id: string) => setProjects((p) => p.filter((x) => x.id !== id)), [])
  const onPatched = React.useCallback((id: string, patch: Partial<ProjectRow>) =>
    setProjects((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x))), [])

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const config = getStatusConfig(column.value)
          const items = projects.filter((p) => (p.status || "planning") === column.value)
          return (
            <Droppable key={column.value} droppableId={column.value}>
              {(provided, snapshot) => (
                <div ref={provided.innerRef} {...provided.droppableProps}
                  className={cn("flex min-h-[8rem] flex-col gap-2.5 rounded-xl border border-t-2 border-border/60 bg-muted/20 p-2.5 transition-colors", snapshot.isDraggingOver && "bg-muted/50")}
                  style={{ borderTopColor: TOP_BORDER[column.value] }}>
                  <div className="flex items-center gap-2 px-1 pb-0.5 pt-1">
                    <span className={cn("size-2 shrink-0 rounded-full", config.fillClass)} aria-hidden />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">{column.label}</span>
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border/70 bg-card px-1.5 text-[11px] font-semibold text-muted-foreground">{items.length}</span>
                  </div>
                  {items.map((project, index) => (
                    <Draggable key={project.id} draggableId={project.id} index={index}>
                      {(dp, ds) => (
                        <div ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} className={cn(ds.isDragging && "opacity-90")}>
                          <ProjectKanbanCard project={project} onRemoved={() => onRemoved(project.id)} onPatched={(patch) => onPatched(project.id, patch)} />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                  {items.length === 0 && !snapshot.isDraggingOver && (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">Slipp prosjekt her</p>
                  )}
                </div>
              )}
            </Droppable>
          )
        })}
      </div>
    </DragDropContext>
  )
}
```

### 3) NY: `app/prosjekter/project-kanban-card.tsx` (client)
Kompakt kort + statuslinje + meny («Flytt til …» / «Arkiver»). Flytt via meny er **ikke-optimistisk** (await → så oppdater state) for å slippe rollback-floker; drag er optimistisk (håndteres i board).
```tsx
"use client"
import * as React from "react"
import Link from "next/link"
import { Archive, MoreVertical } from "lucide-react"
import { toast } from "sonner"
import { reportClientError } from "@/lib/errors/client"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { updateProjectAction } from "./actions"
import { ProjectStatusFooter } from "./project-status-footer"
import { getProjectCode, getProjectCustomer, getProjectPeriod, getStatusConfig, type ProjectRow } from "./project-utils"

const MOVE = [
  { value: "planning", label: "Planlegges" },
  { value: "active", label: "Under utførelse" },
  { value: "on_hold", label: "På pause" },
  { value: "completed", label: "Fullført" },
] as const

export function ProjectKanbanCard({
  project, onRemoved, onPatched,
}: { project: ProjectRow; onRemoved: () => void; onPatched: (patch: Partial<ProjectRow>) => void }) {
  const confirm = useConfirm()
  const customer = getProjectCustomer(project)
  const current = project.status || "planning"

  const moveTo = async (status: string) => {
    if (status === current) return
    try {
      await updateProjectAction(project.id, { status })
      if (status === "completed") onRemoved()
      else onPatched({ status })
      toast.success(`Flyttet til ${MOVE.find((m) => m.value === status)?.label}`)
    } catch (error) {
      reportClientError(error, { context: { action: "endre prosjektstatus (kanban)", projectId: project.id } })
      toast.error("Kunne ikke endre status – prøv igjen")
    }
  }
  const archive = async () => {
    const ok = await confirm({ title: "Arkiver prosjekt", description: `${project.name} flyttes til tidligere prosjekter. Du kan fortsatt åpne det senere.`, confirmText: "Arkiver", cancelText: "Avbryt" })
    if (!ok) return
    try { await updateProjectAction(project.id, { status: "archived" }); onRemoved(); toast.success("Prosjekt arkivert") }
    catch (error) { reportClientError(error, { context: { action: "arkiver prosjekt (kanban)", projectId: project.id } }); toast.error("Kunne ikke arkivere prosjekt") }
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/25">
      <div className="absolute right-1.5 top-1.5 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon"
              className="h-7 w-7 text-muted-foreground hover:bg-muted/80 hover:text-foreground data-[state=open]:opacity-100"
              onClick={(e) => e.preventDefault()} onPointerDown={(e) => e.stopPropagation()}>
              <MoreVertical className="h-4 w-4" /><span className="sr-only">Prosjektinnstillinger</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Flytt til</DropdownMenuLabel>
            {MOVE.map((m) => (
              <DropdownMenuItem key={m.value} disabled={m.value === current} onSelect={() => void moveTo(m.value)}>
                <span className={cn("mr-2 size-2 rounded-full", getStatusConfig(m.value).fillClass)} aria-hidden />{m.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void archive()}><Archive className="mr-2 h-4 w-4" />Arkiver</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Link href={`/prosjekter/${project.id}`} className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-3 pr-9">
          <p className="truncate text-sm font-semibold leading-snug text-foreground group-hover:text-primary">{project.name}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{getProjectCode(project.id)}</p>
          <div className="mt-2.5 min-w-0 space-y-0.5 text-xs text-muted-foreground">
            <p className="truncate">{customer.name}</p>
            <p className="truncate tabular-nums">{getProjectPeriod(project)}</p>
          </div>
        </div>
        <ProjectStatusFooter status={project.status} idPrefix={`${project.id}-kanban`} className="w-full" />
      </Link>
    </div>
  )
}
```

### 4) ENDRE: `app/prosjekter/page.tsx`
- Utvid searchParams-typen med `view?: string`.
- `const initialView = params.view === "kanban" ? "kanban" : "kort"`.
- Erstatt hele `{showActiveSection && (…grid/empty/h2…)}`-blokken (linje ~95–116) med:
  ```tsx
  {showActiveSection && (
    <ActiveProjects projects={activeProjects} customers={customerOptions} initialView={initialView} />
  )}
  ```
- `import { ActiveProjects } from "./active-projects"`. Fjern nå-ubrukt `ProjectCard`-import fra page.tsx (flyttet inn i ActiveProjects). *Tidligere prosjekter*-blokken er uendret.

## Gotchas
- **Klikk vs drag vs meny:** dragHandle ligger på board-wrapperen. Menyknappen har `onPointerDown=stopPropagation` (start ikke drag) + `onClick=preventDefault`. Kort-innholdet er en `Link` (søsken av menyen, ikke inni) → klikk navigerer, stillestående klikk starter ikke drag (dnd-terskel). Samme mønster som oppgave-tavla.
- **Topp-kantfarge:** theme-klassene setter spesifikke sider; bruk `TOP_BORDER`-map inline for `border-top-color`. Prikken bruker `config.fillClass` (background).
- **Tomme kolonner:** `min-h-[8rem]` så de er droppable; «Slipp prosjekt her» skjules under drag-over (`provided.placeholder` tar plassen).
- **`active` = lys lime (#c7ef63):** bevisst app-farge, lav kontrast på hvit. Hvis du vil ha mer punch senere: vurder dypere grønn for active i `project-utils.ts` (egen avgjørelse, ikke del av denne planen).

## Verifisering før commit
- `npx tsc --noEmit` (eller `next build`) — fanger import-/type-feil.
- Manuelt: toggle bytter uten refetch; `?view=kanban` overlever reload; drag mellom kolonner persisterer status (sjekk DB/refresh); «Arkiver» spør via useConfirm og flytter til arkiv-tabellen; kort-visning er identisk med før.

## Mulige follow-ups (ikke i scope)
- Paritet i kanban-meny: «Endre navn»/«Endre kunde» (krever `customers`-prop inn igjen + dialoger).
- Egen «Fullført»-kolonne på tavla i stedet for arkiv-strip.
- Berik kort (kort + kanban) med oppgaver/avvik/fremdrift via RPC (grupperte tall) — se mockup A.
