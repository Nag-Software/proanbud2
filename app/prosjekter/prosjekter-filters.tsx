"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTransition } from "react"
import { Search, X } from "lucide-react"

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

  const currentStatus = searchParams.get("status") || "all"
  const currentSort = searchParams.get("sort") || "name"
  const currentQuery = searchParams.get("search") || ""

  const handleStatusChange = (status: string) => {
    const params = new URLSearchParams(searchParams)
    if (status === "all") {
      params.delete("status")
    } else {
      params.set("status", status)
    }
    startTransition(() => {
      replace(`${pathname}?${params.toString()}`)
    })
  }

  const handleSortChange = (sort: string) => {
    const params = new URLSearchParams(searchParams)
    if (sort === "name") {
      params.delete("sort")
    } else {
      params.set("sort", sort)
    }
    startTransition(() => {
      replace(`${pathname}?${params.toString()}`)
    })
  }

  const handleSearchChange = (term: string) => {
    const params = new URLSearchParams(searchParams)
    if (term) {
      params.set("search", term)
    } else {
      params.delete("search")
    }
    startTransition(() => {
      replace(`${pathname}?${params.toString()}`)
    })
  }

  const resetFilters = () => {
    startTransition(() => {
      replace(pathname)
    })
  }

  const hasActiveFilters =
    currentStatus !== "all" || currentSort !== "name" || currentQuery.trim().length > 0

  return (
    <div className="rounded-xl border-0 border-border/60 bg-card/60">
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Søk</p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9"
              placeholder="Søk prosjekt, kunde eller ID"
              defaultValue={currentQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
            />
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Sorter</p>
          <Select value={currentSort} onValueChange={handleSortChange} disabled={isPending}>
            <SelectTrigger className="h-9 w-full md:w-[180px]">
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
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
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
