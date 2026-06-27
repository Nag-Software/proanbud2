"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, MapPin } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { GeocodeResult } from "@/lib/kjorebok/types"

// Debounced address search backed by /api/kjorebok/geocode (Kartverket → MapTiler).
// On selection it reports the chosen coordinates; free typing reports text only.

type Props = {
  value: string
  onChange: (label: string) => void
  onSelect: (result: GeocodeResult) => void
  placeholder?: string
  id?: string
  /** Extra classes for the underlying input (e.g. borderless inside a map card). */
  inputClassName?: string
}

export function GeocodeAutocomplete({ value, onChange, onSelect, placeholder, id, inputClassName }: Props) {
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const skipNextRef = useRef(false)

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false
      return
    }
    const q = value.trim()
    if (q.length < 3) {
      setResults([])
      setOpen(false)
      setLoading(false)
      return
    }
    setLoading(true)
    // `cancelled` makes the LATEST effect run the only one allowed to commit
    // results, so an out-of-order stale response can't overwrite fresh ones (and
    // can't setState after the dialog closes). AbortController cancels the request.
    let cancelled = false
    const ctrl = new AbortController()
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/kjorebok/geocode?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        })
        const data = await res.json()
        if (cancelled) return
        setResults(Array.isArray(data?.results) ? data.results : [])
        setActive(-1)
        setOpen(true)
      } catch {
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      ctrl.abort()
      clearTimeout(handle)
    }
  }, [value])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  function pick(result: GeocodeResult) {
    skipNextRef.current = true
    onChange(result.label)
    onSelect(result)
    setOpen(false)
    setActive(-1)
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        className={cn(inputClassName)}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, results.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault()
            pick(results[active])
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
      />
      {open && (loading || results.length > 0) && (
        <div className="absolute left-0 z-50 mt-2 max-h-72 w-full min-w-[20rem] max-w-[calc(100vw-2rem)] overflow-auto overflow-x-hidden rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-xl ring-1 ring-black/5">
          {loading && results.length === 0 && (
            <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Søker…
            </div>
          )}
          {results.map((r, i) => {
            const [primary, ...rest] = r.label.split(",")
            const secondary = rest.join(",").trim()
            return (
              <button
                type="button"
                key={`${r.lat},${r.lng},${i}`}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  i === active ? "bg-muted" : "hover:bg-muted/70"
                )}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(r)}
              >
                <MapPin
                  className={cn(
                    "size-4 shrink-0",
                    i === active ? "text-foreground" : "text-muted-foreground"
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {primary.trim()}
                  </span>
                  {secondary && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {secondary}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
