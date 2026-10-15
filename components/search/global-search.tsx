"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  FileTextIcon,
  FolderIcon,
  FolderPlusIcon,
  LoaderCircle,
  PlusCircleIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react"

import { track } from "@/lib/analytics/track"
import { filterAppNav } from "@/lib/app-nav"
import { canSendOffers } from "@/lib/roles"
import { useUserRole } from "@/hooks/use-user-role"
import { cn } from "@/lib/utils"

/**
 * Globalt søk i macOS Spotlight-stil: ⌘K/Ctrl+K åpner en flytende palett som
 * søker på tvers av sider, prosjekter, kunder og tilbud. Triggeren i headeren
 * og hurtigtasten snakker sammen via et window-event (samme mønster som
 * tutorial-veiviserens START_TUTORIAL_EVENT), så paletten kan monteres én gang
 * i app-skallet uavhengig av hvor knappene bor.
 */
export const OPEN_GLOBAL_SEARCH_EVENT = "proanbud:open-global-search"

type EntityResults = {
  projects: { id: string; name: string; status: string | null }[]
  customers: { id: string; name: string; city: string | null }[]
  offers: { id: string; title: string; status: string | null }[]
}

const EMPTY_RESULTS: EntityResults = { projects: [], customers: [], offers: [] }

type PaletteItem = {
  key: string
  group: "handlinger" | "sider" | "prosjekter" | "kunder" | "tilbud"
  title: string
  subtitle?: string
  href: string
  icon: React.ReactNode
}

const GROUP_LABELS: Record<PaletteItem["group"], string> = {
  handlinger: "Handlinger",
  sider: "Sider",
  prosjekter: "Prosjekter",
  kunder: "Kunder",
  tilbud: "Tilbud",
}

const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: "Utkast",
  sent: "Sendt",
  accepted: "Akseptert",
  rejected: "Avslått",
}

const PROJECT_STATUS_LABELS: Record<string, string> = {
  planning: "Planlegging",
  active: "Aktivt",
  on_hold: "På vent",
  completed: "Fullført",
}

function normalize(value: string) {
  return value.toLowerCase().normalize("NFKD")
}

export function GlobalSearchTrigger({ className }: { className?: string }) {
  // Riktig tastehint uten hydration-avvik: server og første klientframe viser
  // ⌘K, og ikke-Mac oppdateres til Ctrl K i en effekt etter hydrering.
  const [isMac, setIsMac] = React.useState(true)
  React.useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent))
  }, [])

  const openSearch = () => {
    window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SEARCH_EVENT))
  }

  return (
    <>
      {/* Desktop: macOS-aktig søkefelt med tastehint */}
      <button
        type="button"
        onClick={openSearch}
        className={cn(
          "hidden h-8 w-52 items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted/70 md:flex",
          className
        )}
      >
        <SearchIcon className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left text-[13px]">Søk…</span>
        <kbd className="pointer-events-none rounded-md border border-border/70 bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>
      {/* Mobil: kun ikon */}
      <button
        type="button"
        onClick={openSearch}
        aria-label="Søk i ProAnbud"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground md:hidden"
      >
        <SearchIcon className="size-4.5" />
      </button>
    </>
  )
}

export function GlobalSearch() {
  const router = useRouter()
  const { role, isWorker, hasFeature, loadingRole } = useUserRole()

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<EntityResults>(EMPTY_RESULTS)
  const [loading, setLoading] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const close = React.useCallback(() => {
    setOpen(false)
    setQuery("")
    setResults(EMPTY_RESULTS)
    setActiveIndex(0)
    abortRef.current?.abort()
  }, [])

  // Ref-speil av open, så det globale keydown-lytteret slipper å re-monteres
  // (og Escape virker uansett hvor fokus står).
  const openRef = React.useRef(open)
  React.useEffect(() => {
    openRef.current = open
  }, [open])

  // ⌘K / Ctrl+K + åpne-event fra triggerknappene
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (!openRef.current) track("globalsok_apnet", { via: "hurtigtast" })
        setOpen(!openRef.current)
        return
      }
      if (event.key === "Escape" && openRef.current) {
        setOpen(false)
      }
    }
    const onOpenEvent = () => {
      track("globalsok_apnet", { via: "knapp" })
      setOpen(true)
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener(OPEN_GLOBAL_SEARCH_EVENT, onOpenEvent)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener(OPEN_GLOBAL_SEARCH_EVENT, onOpenEvent)
    }
  }, [])

  React.useEffect(() => {
    if (open) {
      // Fokusér etter at panelet er malt
      const timer = window.setTimeout(() => inputRef.current?.focus(), 10)
      return () => window.clearTimeout(timer)
    }
  }, [open])

  // Debounced entitetssøk
  React.useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(EMPTY_RESULTS)
      setLoading(false)
      return
    }

    setLoading(true)
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/sok/global?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          setResults(EMPTY_RESULTS)
          return
        }
        const data = (await response.json()) as EntityResults
        setResults({
          projects: data.projects ?? [],
          customers: data.customers ?? [],
          offers: data.offers ?? [],
        })
      } catch {
        // Avbrutt eller nettverksfeil — behold forrige/tomme resultater stille
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 180)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [open, query])

  // Sider + hurtighandlinger fra den delte, rollefiltrerte nav-konfigen
  // (lib/app-nav) — samme regler som sidebaren.
  const items = React.useMemo<PaletteItem[]>(() => {
    const visiblePages = filterAppNav({ role, isWorker, loadingRole, hasFeature })

    const normalizedQuery = normalize(query.trim())
    const list: PaletteItem[] = []

    if (!normalizedQuery) {
      // Tom spørring: hurtighandlinger + de vanligste sidene
      if (!isWorker) {
        list.push({
          key: "action-nytt-prosjekt",
          group: "handlinger",
          title: "Nytt prosjekt",
          href: "/prosjekter/ny",
          icon: <FolderPlusIcon className="size-4" />,
        })
      }
      if (canSendOffers(role)) {
        list.push({
          key: "action-nytt-tilbud",
          group: "handlinger",
          title: "Nytt tilbud",
          href: "/nytt-tilbud",
          icon: <PlusCircleIcon className="size-4" />,
        })
      }
      if (!isWorker) {
        list.push({
          key: "action-prisfil",
          group: "handlinger",
          title: "Last opp prisfil",
          href: "/mine-priser/prisfiler",
          icon: <UploadIcon className="size-4" />,
        })
      }
      for (const page of visiblePages.slice(0, 6)) {
        list.push({
          key: `page-${page.href}`,
          group: "sider",
          title: page.title,
          href: page.href,
          icon: <page.icon className="size-4" />,
        })
      }
      return list
    }

    for (const page of visiblePages) {
      const haystack = normalize(`${page.title} ${page.keywords ?? ""}`)
      if (haystack.includes(normalizedQuery)) {
        list.push({
          key: `page-${page.href}`,
          group: "sider",
          title: page.title,
          href: page.href,
          icon: <page.icon className="size-4" />,
        })
      }
    }

    for (const project of results.projects) {
      list.push({
        key: `project-${project.id}`,
        group: "prosjekter",
        title: project.name,
        subtitle: project.status ? PROJECT_STATUS_LABELS[project.status] ?? undefined : undefined,
        href: `/prosjekter/${project.id}`,
        icon: <FolderIcon className="size-4" />,
      })
    }

    for (const customer of results.customers) {
      list.push({
        key: `customer-${customer.id}`,
        group: "kunder",
        title: customer.name,
        subtitle: customer.city ?? undefined,
        // Kundedetaljen bor i en skuff på /kunder — sok-parameteren
        // forhåndsfiltrerer lista til kunden.
        href: `/kunder?sok=${encodeURIComponent(customer.name)}`,
        icon: <UsersIcon className="size-4" />,
      })
    }

    for (const offer of results.offers) {
      list.push({
        key: `offer-${offer.id}`,
        group: "tilbud",
        title: offer.title,
        subtitle: offer.status ? OFFER_STATUS_LABELS[offer.status] ?? offer.status : undefined,
        href: `/tilbud/${offer.id}`,
        icon: <FileTextIcon className="size-4" />,
      })
    }

    return list
  }, [query, results, isWorker, role, hasFeature, loadingRole])

  // Hold aktiv rad innenfor lista når resultatene endrer seg
  React.useEffect(() => {
    setActiveIndex(0)
  }, [query, results])

  React.useEffect(() => {
    document.getElementById(`global-search-item-${activeIndex}`)?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const selectItem = React.useCallback(
    (item: PaletteItem) => {
      track("globalsok_valgt", { type: item.group })
      close()
      router.push(item.href)
    },
    [close, router]
  )

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveIndex((previous) => (items.length === 0 ? 0 : (previous + 1) % items.length))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveIndex((previous) => (items.length === 0 ? 0 : (previous - 1 + items.length) % items.length))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const item = items[activeIndex]
      if (item) selectItem(item)
    } else if (event.key === "Escape") {
      // Som macOS Spotlight: lukk men behold søket, så gjenåpning fortsetter
      // der brukeren slapp. Full nullstilling skjer først ved valg.
      event.preventDefault()
      setOpen(false)
    }
  }

  if (!open) return null

  const showEmptyState = query.trim().length >= 2 && !loading && items.length === 0

  // Spotlight-stil: frostet glass med store, myke hjørner (temaets rounded-*
  // er 5 px, så radiene står eksplisitt), rolige gruppetitler og ett snev av
  // Proanbud-grønt – på ikonet til raden du står på.
  return (
    <div
      className="fixed inset-0 z-[95] bg-black/[0.18] duration-150 animate-in fade-in-0 supports-backdrop-filter:backdrop-blur-[3px] dark:bg-black/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Globalt søk"
    >
      <div className="mx-auto mt-[10vh] w-[calc(100%-1.5rem)] max-w-[640px] overflow-hidden rounded-[18px] bg-[color-mix(in_oklab,var(--popover)_94%,transparent)] text-popover-foreground shadow-[0_0_0_0.5px_rgba(0,0,0,0.14),0_1px_0_0_rgba(255,255,255,0.6)_inset,0_24px_70px_-12px_rgba(0,0,0,0.32),0_8px_24px_-8px_rgba(0,0,0,0.12)] duration-200 animate-in fade-in-0 zoom-in-[0.97] slide-in-from-top-2 supports-backdrop-filter:backdrop-blur-2xl supports-backdrop-filter:backdrop-saturate-150 sm:mt-[16vh] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.12),0_24px_70px_-12px_rgba(0,0,0,0.7)]">
        {/* Søkefeltet */}
        <div className="flex h-[58px] items-center gap-3 px-5">
          {loading ? (
            <LoaderCircle className="size-5 shrink-0 animate-spin text-muted-foreground" strokeWidth={1.75} />
          ) : (
            <SearchIcon className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Søk i Proanbud"
            aria-label="Søk i prosjekter, kunder, tilbud og sider"
            className="h-full flex-1 bg-transparent text-[19px] font-normal tracking-[-0.01em] outline-none placeholder:text-muted-foreground/60"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("")
                inputRef.current?.focus()
              }}
              className="rounded-full px-2 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-black/[0.05] hover:text-foreground dark:hover:bg-white/10"
            >
              Tøm
            </button>
          ) : null}
        </div>

        <div className="mx-4 h-px bg-black/[0.07] dark:bg-white/10" />

        {/* Resultater */}
        <div className="max-h-[min(52vh,440px)] overflow-y-auto overscroll-contain px-2 pb-2 pt-1.5">
          {showEmptyState ? (
            <div className="px-3 py-12 text-center">
              <p className="text-[15px] font-medium">Ingen treff for «{query.trim()}»</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Prøv et kortere søkeord, eller sjekk stavemåten.</p>
            </div>
          ) : (
            (["handlinger", "sider", "prosjekter", "kunder", "tilbud"] as const).map((group) => {
              const groupItems = items.filter((item) => item.group === group)
              if (groupItems.length === 0) return null
              return (
                <div key={group} role="group" aria-label={GROUP_LABELS[group]} className="mt-1 first:mt-0">
                  <p className="px-3 pb-1 pt-2.5 text-[11.5px] font-semibold text-muted-foreground/80">
                    {GROUP_LABELS[group]}
                  </p>
                  {groupItems.map((item) => {
                    const index = items.indexOf(item)
                    const isActive = index === activeIndex
                    return (
                      <button
                        key={item.key}
                        id={`global-search-item-${index}`}
                        type="button"
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => selectItem(item)}
                        onMouseMove={() => setActiveIndex(index)}
                        className={cn(
                          "flex min-h-10 w-full items-center gap-3 rounded-[9px] px-2.5 py-1.5 text-left text-[14px] transition-colors duration-75 pointer-coarse:min-h-12",
                          isActive ? "bg-black/[0.06] dark:bg-white/[0.09]" : "text-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-[8px] transition-colors duration-75 [&_svg]:size-[15px]",
                            isActive
                              ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                              : "bg-black/[0.045] text-foreground/70 dark:bg-white/[0.08]"
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium leading-5 tracking-[-0.005em]">{item.title}</span>
                          {item.subtitle ? (
                            <span className="block truncate text-[12px] leading-4 text-muted-foreground">{item.subtitle}</span>
                          ) : null}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "shrink-0 text-[13px] text-muted-foreground transition-opacity duration-75",
                            isActive ? "opacity-100" : "opacity-0"
                          )}
                        >
                          ↵
                        </span>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        {/* Bunnlinje: diskré tastehint, som i macOS. */}
        <div className="hidden items-center justify-end gap-4 border-t border-black/[0.06] px-4 py-2 text-[11.5px] text-muted-foreground sm:flex dark:border-white/10">
          <span className="flex items-center gap-1.5">
            <Tast>↑</Tast>
            <Tast>↓</Tast>
            Velg
          </span>
          <span className="flex items-center gap-1.5">
            <Tast>↵</Tast>
            Åpne
          </span>
          <span className="flex items-center gap-1.5">
            <Tast>esc</Tast>
            Lukk
          </span>
        </div>
      </div>
    </div>
  )
}

function Tast({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-black/[0.06] px-1 font-sans text-[10.5px] font-medium text-foreground/70 dark:bg-white/10">
      {children}
    </kbd>
  )
}
