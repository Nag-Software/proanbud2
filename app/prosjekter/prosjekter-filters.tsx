"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import { useTransition } from "react"
import { createPortal } from "react-dom"
import { Loader2, Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ProjectsViewToggle } from "./projects-view"

const statusFilters = [
  { value: "all", label: "Alle" },
  { value: "planning", label: "Planlegges" },
  { value: "active", label: "Aktiv" },
  { value: "on_hold", label: "Avventer" },
  { value: "completed", label: "Fullført" },
  { value: "rejected", label: "Avvist" },
  { value: "archived", label: "Arkivert" },
] as const

const sortOptions = [
  { key: "name", label: "Navn" },
  { key: "updated_at", label: "Sist oppdatert" },
] as const

export function ProsjekterFilters() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const { replace } = useRouter()
  const [isPending, startTransition] = useTransition()
  // Søket ventet før på hvert tastetrykk → én serverrunde per bokstav mot en DB
  // i eu-west-1. Vi debouncer, men markerer «venter» med en gang så indikatoren
  // slår inn mens brukeren fortsatt skriver.
  const [isDebouncing, setIsDebouncing] = React.useState(false)
  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [])

  // Sant både under debounce og under selve serverrunden — driver alle
  // «jobber»-indikatorene under.
  const isBusy = isPending || isDebouncing

  const currentStatus = searchParams.get("status") || "all"
  const currentSort = searchParams.get("sort") || "name"
  const currentQuery = searchParams.get("search") || ""

  const pushParams = React.useCallback(
    (params: URLSearchParams) => {
      const query = params.toString()
      startTransition(() => {
        replace(query ? `${pathname}?${query}` : pathname)
      })
    },
    [pathname, replace, startTransition]
  )

  const handleStatusChange = (status: string) => {
    const params = new URLSearchParams(searchParams)
    if (status === "all") {
      params.delete("status")
    } else {
      params.set("status", status)
    }
    pushParams(params)
  }

  const handleSortChange = (sort: string) => {
    const params = new URLSearchParams(searchParams)
    if (sort === "name") {
      params.delete("sort")
    } else {
      params.set("sort", sort)
    }
    pushParams(params)
  }

  const handleSearchChange = (term: string) => {
    const params = new URLSearchParams(searchParams)
    if (term) {
      params.set("search", term)
    } else {
      params.delete("search")
    }
    // Debounce: bare det siste tastetrykket treffer serveren.
    setIsDebouncing(true)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setIsDebouncing(false)
      pushParams(params)
    }, 350)
  }

  const resetFilters = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setIsDebouncing(false)
    startTransition(() => {
      replace(pathname)
    })
  }

  const hasActiveFilters =
    currentStatus !== "all" || currentSort !== "name" || currentQuery.trim().length > 0

  return (
    <div className="rounded-xl border-0 border-border/60 bg-card/60">
      <TopProgressBar active={isBusy} />
      <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
        <div className="sm:space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Søk</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9 pr-9"
              placeholder="Søk prosjekt, kunde eller ID"
              defaultValue={currentQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
            {isBusy && (
              <Loader2
                className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
                aria-hidden
              />
            )}
          </div>
        </div>

        <div className="sm:space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Sorter</p>
          <div className="flex items-stretch gap-2">
            <Select value={currentSort} onValueChange={handleSortChange} disabled={isPending}>
              <SelectTrigger className="h-9 w-1/2 md:w-[180px]">
                <SelectValue placeholder="Sorter etter" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Sorter etter</SelectLabel>
                  {sortOptions.map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {/* Kort/Kanban-bryteren bor til høyre for Sorter på alle skjermer. */}
            <ProjectsViewToggle className="ml-auto" />
          </div>
        </div>
      </div>

      <div className="hidden! mt-3 flex flex-wrap items-center gap-2">
        {statusFilters.map((status) => {
          const isActive = currentStatus === status.value

          return (
            <Button
              key={status.value}
              size="sm"
              variant={isActive ? "default" : "outline"}
              onClick={() => handleStatusChange(status.value)}
              disabled={isPending}
            >
              {status.label}
            </Button>
          )
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto cursor-pointer"
          onClick={resetFilters}
          disabled={!hasActiveFilters || isPending}
        >
          <X className="mr-2 size-4" />
          Nullstill
        </Button>
      </div>
    </div>
  )
}

/**
 * Tynn «jobber i bakgrunnen»-linje festet øverst i viewporten mens siden henter
 * nye prosjekter etter et søk eller filterbytte. Ligger i en portal på <body> så
 * den flyter over layouten uten å dytte innhold, og fyller gapet Next.js sin
 * `loading.tsx` ikke dekker (den vises kun ved første navigasjon til ruten, ikke
 * når bare søkeparametrene endres).
 */
function TopProgressBar({ active }: { active: boolean }) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (!mounted || !active) return null

  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden"
      role="status"
      aria-label="Oppdaterer prosjekter"
    >
      <div
        className="h-full w-1/3 bg-primary/80"
        style={{ animation: "pa-indeterminate 1.1s ease-in-out infinite" }}
      />
    </div>,
    document.body
  )
}
