"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type ClientOption = {
  id: string
  name: string
  city?: string | null
}

type ClientAutocompleteProps = {
  options: ClientOption[]
  value: string
  onChange: (nextId: string) => void
  error?: string
}

export function ClientAutocomplete({ options, value, onChange, error }: ClientAutocompleteProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)

  const selected = options.find((client) => client.id === value)

  const filtered = useMemo(() => {
    if (!query.trim()) return options.slice(0, 8)
    const needle = query.toLowerCase()
    return options
      .filter((client) => `${client.name} ${client.city || ""}`.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [options, query])

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full h-10 justify-between rounded-lg text-left text-base text-sm",
              error && "border-destructive"
            )}
          >
            <span className="truncate">{selected ? selected.name : "Velg kunde"}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-w-[var(--radix-popover-trigger-width)] p-1.5">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Søk kunde..."
            className="h-9 w-full"
          />

          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-3 py-1 text-sm text-muted-foreground">Ingen kunder matcher søket.</p>
            )}

            {filtered.map((client) => (
              <Button
                key={client.id}
                type="button"
                variant="ghost"
                className="flex h-auto min-h-8 w-full items-center justify-between rounded-md px-3 text-left text-sm"
                onClick={() => {
                  onChange(client.id)
                  setOpen(false)
                  setQuery("")
                }}
              >
                <span className="truncate">
                  {client.name}
                  {client.city ? <span className="text-muted-foreground"> - {client.city}</span> : null}
                </span>
                {value === client.id && <Check className="h-4 w-4 text-primary" />}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
