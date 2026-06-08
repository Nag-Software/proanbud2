"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ExternalLink, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { calculateLineItemTotal, formatNok, type OfferLineItem } from "@/lib/tilbud/types"

type NewOfferItemsTableProps = {
  items: OfferLineItem[]
  onItemsChange: (next: OfferLineItem[]) => void
  supplierSuggestions: string[]
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value.replace(",", "."))
  return Number.isFinite(parsed) ? parsed : fallback
}

function resolveNobb(item: OfferLineItem) {
  const direct = item.nobb?.trim()
  if (direct) return direct

  const fallback = item.supplierSku?.trim() || ""
  const digitsOnly = fallback.replace(/\D/g, "")
  if (digitsOnly.length >= 6 && digitsOnly.length <= 10) {
    return digitsOnly
  }

  return null
}

function EditableSelect({
  value,
  onChange,
  options,
  placeholder = "—",
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (editing) selectRef.current?.focus()
  }, [editing])

  if (editing) {
    return (
      <select
        ref={selectRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className={cn(
          "w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm outline-none ring-2 ring-primary/20",
          className
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={cn(
        "block cursor-pointer truncate rounded px-1.5 py-0.5 text-sm hover:bg-muted/60",
        !value ? "text-muted-foreground/50" : "inline-block rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      {value || placeholder}
    </span>
  )
}

function EditableText({
  value,
  onChange,
  placeholder = "—",
  className,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    onChange(draft)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") { setDraft(value); setEditing(false) }
        }}
        className={cn(
          "w-full min-w-0 rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm outline-none ring-2 ring-primary/20",
          className
        )}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      className={cn(
        "block cursor-text truncate rounded px-1.5 py-0.5 text-sm hover:bg-muted/60",
        !value && "text-muted-foreground/50",
        className
      )}
    >
      {value || placeholder}
    </span>
  )
}

function EditableNumber({
  value,
  onChange,
  format,
  min,
  max,
  step,
  className,
}: {
  value: number
  onChange: (v: number) => void
  format?: (v: number) => string
  min?: number
  max?: number
  step?: number
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [editing])

  const commit = () => {
    onChange(parseNumber(draft, value))
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") { setDraft(String(value)); setEditing(false) }
        }}
        className={cn(
          "w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm tabular-nums outline-none ring-2 ring-primary/20",
          className
        )}
      />
    )
  }

  return (
    <span
      onClick={() => {
        setDraft(String(value))
        setEditing(true)
      }}
      className={cn(
        "block cursor-text rounded px-1.5 py-0.5 text-sm tabular-nums hover:bg-muted/60",
        className
      )}
    >
      {format ? format(value) : value}
    </span>
  )
}

export function NewOfferItemsTable({ items, onItemsChange, supplierSuggestions }: NewOfferItemsTableProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const updateRow = useCallback(
    (id: string, patch: Partial<OfferLineItem>) => {
      onItemsChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    },
    [items, onItemsChange]
  )

  const removeRow = useCallback(
    (id: string) => {
      onItemsChange(items.filter((item) => item.id !== id))
    },
    [items, onItemsChange]
  )

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  const groups = useMemo(() => {
    const map: Record<string, OfferLineItem[]> = {}
    for (const item of items) {
      const key = item.subproject?.trim() || "Generelt"
      if (!map[key]) map[key] = []
      map[key].push(item)
    }
    return map
  }, [items])

  const groupOrder = useMemo(() => Object.keys(groups), [groups])

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-background">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-[35%] text-xs font-semibold uppercase tracking-wide text-muted-foreground">Produkt / element</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leverandør</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enhetspris</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Antall</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enhet</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Påslag</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rabatt</TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linjesum</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupOrder.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-20 text-center text-sm text-muted-foreground">
                  Ingen elementer enda. Start med analyse eller legg til manuelt.
                </TableCell>
              </TableRow>
            ) : (
              groupOrder.map((group) => {
                const groupItems = groups[group]
                const isExpanded = !collapsedGroups.has(group)
                return (
                  <Fragment key={group}>
                    <TableRow
                      className="cursor-pointer bg-muted/50 hover:bg-muted/70 select-none"
                      onClick={() => toggleGroup(group)}
                    >
                      <TableCell colSpan={9} className="py-2">
                        <div className="flex items-center gap-2">
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                              !isExpanded && "-rotate-90"
                            )}
                          />
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</span>
                          <Badge variant="outline" className="ml-0.5 h-4 rounded-sm px-1.5 text-[10px] font-normal">
                            {groupItems.length}
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isExpanded &&
                      groupItems.map((item) => (
                        <TableRow key={item.id} className="group/row hover:bg-muted/20">
                          <TableCell className="py-1">
                            <div className="flex items-center gap-1">
                              <div className="min-w-0 flex-1">
                                <EditableText
                                  value={item.title}
                                  onChange={(v) => updateRow(item.id, { title: v })}
                                  placeholder="Produktnavn..."
                                  className="font-medium"
                                />
                              </div>
                              {resolveNobb(item) ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  title={`Åpne NOBB ${resolveNobb(item)}`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    const nobb = resolveNobb(item)
                                    if (!nobb) return
                                    window.open(`https://nobb.no/item/${encodeURIComponent(nobb)}`, "_blank", "noopener,noreferrer")
                                  }}
                                  aria-label={`Åpne NOBB ${resolveNobb(item)}`}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="py-1">
                            <EditableSelect
                              value={item.supplier ?? ""}
                              onChange={(v) => updateRow(item.id, { supplier: v })}
                              options={supplierSuggestions}
                              placeholder="Velg prisliste"
                            />
                          </TableCell>
                          <TableCell className="py-1">
                            <EditableNumber
                              value={item.unitPriceNok}
                              onChange={(v) => updateRow(item.id, { unitPriceNok: v })}
                              format={(v) => v.toLocaleString("no-NO", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " kr"}
                              min={0}
                              step={0.01}
                              className="w-28"
                            />
                          </TableCell>
                          <TableCell className="py-1">
                            <EditableNumber
                              value={item.quantity}
                              onChange={(v) => updateRow(item.id, { quantity: v })}
                              min={0}
                              step={1}
                              className="w-16"
                            />
                          </TableCell>
                          <TableCell className="py-1">
                            <EditableText
                              value={item.unit}
                              onChange={(v) => updateRow(item.id, { unit: v })}
                              placeholder="stk"
                              className="w-14 text-muted-foreground"
                            />
                          </TableCell>
                          <TableCell className="py-1">
                            <EditableNumber
                              value={item.markupPercent}
                              onChange={(v) => updateRow(item.id, { markupPercent: v })}
                              format={(v) => v + "%"}
                              min={0}
                              max={100}
                              step={0.1}
                              className="w-16"
                            />
                          </TableCell>
                          <TableCell className="py-1">
                            <EditableNumber
                              value={item.discountPercent}
                              onChange={(v) => updateRow(item.id, { discountPercent: v })}
                              format={(v) => v + "%"}
                              min={0}
                              max={100}
                              step={0.1}
                              className="w-16"
                            />
                          </TableCell>
                          <TableCell className="py-1 text-right tabular-nums text-sm font-semibold text-foreground">
                            {formatNok(calculateLineItemTotal(item))}
                          </TableCell>
                          <TableCell className="py-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-transparent group-hover/row:text-muted-foreground hover:!text-destructive"
                              onClick={() => removeRow(item.id)}
                              aria-label="Fjern rad"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
