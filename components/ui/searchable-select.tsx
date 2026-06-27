"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// A Select-look-alike combobox with a search field pinned to the top of the
// dropdown. Built on Popover (not Radix Select) so the search input keeps focus
// and isn't fought by Select's built-in typeahead. Use when the option list is
// long enough to warrant filtering (projects, drivers, …).

export type SearchableSelectOption = {
  value: string
  label: string
  /** Extra text to match against when searching (e.g. a registration number). */
  keywords?: string
}

type Props = {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  id?: string
  className?: string
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Velg…",
  searchPlaceholder = "Søk…",
  emptyText = "Ingen treff",
  id,
  className,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(q))
  }, [options, query])

  // Start each open with a clean query.
  React.useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            className
          )}
        >
          <span className={cn("line-clamp-1 text-left", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div className="flex items-center gap-2 border-b px-2.5">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                  o.value === value && "bg-accent/60"
                )}
              >
                <CheckIcon
                  className={cn("size-4 shrink-0", o.value === value ? "opacity-100" : "opacity-0")}
                />
                <span className="line-clamp-1">{o.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
