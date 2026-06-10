"use client"

import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react"
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd"
import { ChevronDown, ExternalLink, GripVertical, Trash2 } from "lucide-react"

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

export type NewOfferItemsTableHandle = {
  addCategory: () => string
  removeCategory: (group: string) => void
  getCategories: () => string[]
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

function normalizeGroupName(value: string) {
  return value.trim() || "Generelt"
}

function buildGroups(items: OfferLineItem[]) {
  const map: Record<string, OfferLineItem[]> = {}
  for (const item of items) {
    const key = normalizeGroupName(item.subproject)
    if (!map[key]) map[key] = []
    map[key].push(item)
  }
  return map
}

function flattenGroupedItems(groupOrder: string[], groups: Record<string, OfferLineItem[]>) {
  return groupOrder.flatMap((group) => groups[group] || [])
}

function reorderItemsInGroup(items: OfferLineItem[], group: string, fromIndex: number, toIndex: number) {
  const groups = buildGroups(items)
  const groupItems = [...(groups[group] || [])]
  const [moved] = groupItems.splice(fromIndex, 1)
  if (!moved) return items

  groupItems.splice(toIndex, 0, moved)
  groups[group] = groupItems
  const groupOrder = Object.keys(groups)
  return flattenGroupedItems(groupOrder, groups)
}

function moveItemBetweenGroups(
  items: OfferLineItem[],
  sourceGroup: string,
  destinationGroup: string,
  sourceIndex: number,
  destinationIndex: number
) {
  const groups = buildGroups(items)
  const sourceItems = [...(groups[sourceGroup] || [])]
  const destinationItems = sourceGroup === destinationGroup ? sourceItems : [...(groups[destinationGroup] || [])]

  const [moved] = sourceItems.splice(sourceIndex, 1)
  if (!moved) return items

  const nextItem = { ...moved, subproject: destinationGroup }
  destinationItems.splice(destinationIndex, 0, nextItem)

  groups[sourceGroup] = sourceItems
  groups[destinationGroup] = destinationItems

  const groupOrder = Object.keys(groups).filter((group) => (groups[group]?.length || 0) > 0)
  return flattenGroupedItems(groupOrder, groups)
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
        onChange={(e) => {
          onChange(e.target.value)
          setEditing(false)
        }}
        onBlur={() => setEditing(false)}
        className={cn(
          "w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-sm outline-none ring-2 ring-primary/20",
          className
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className={cn(
        "block cursor-pointer truncate rounded px-1.5 py-0.5 text-sm hover:bg-muted/60",
        !value
          ? "text-muted-foreground/50"
          : "inline-block rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground",
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
  onClick,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  onClick?: (event: MouseEvent) => void
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
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit()
          if (e.key === "Escape") {
            setDraft(value)
            setEditing(false)
          }
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
      onClick={(event) => {
        onClick?.(event)
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
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
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
          if (e.key === "Escape") {
            setDraft(String(value))
            setEditing(false)
          }
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
      className={cn("block cursor-text rounded px-1.5 py-0.5 text-sm tabular-nums hover:bg-muted/60", className)}
    >
      {format ? format(value) : value}
    </span>
  )
}

export const NewOfferItemsTable = forwardRef<NewOfferItemsTableHandle, NewOfferItemsTableProps>(function NewOfferItemsTable(
  { items, onItemsChange, supplierSuggestions },
  ref
) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [emptyGroups, setEmptyGroups] = useState<string[]>([])

  const groups = useMemo(() => buildGroups(items), [items])

  const groupOrder = useMemo(() => {
    const existing = Object.keys(groups)
    const extras = emptyGroups.filter((group) => !existing.includes(group))
    return [...existing, ...extras]
  }, [emptyGroups, groups])

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

  const renameGroup = useCallback(
    (oldName: string, nextNameRaw: string) => {
      const nextName = normalizeGroupName(nextNameRaw)
      if (nextName === oldName) return

      onItemsChange(
        items.map((item) =>
          normalizeGroupName(item.subproject) === oldName ? { ...item, subproject: nextName } : item
        )
      )

      setEmptyGroups((prev) => prev.map((group) => (group === oldName ? nextName : group)).filter(Boolean))
      setCollapsedGroups((prev) => {
        const next = new Set(prev)
        if (next.has(oldName)) {
          next.delete(oldName)
          next.add(nextName)
        }
        return next
      })
    },
    [items, onItemsChange]
  )

  const groupOrderRef = useRef(groupOrder)
  const groupsRef = useRef(groups)
  const itemsRef = useRef(items)

  groupOrderRef.current = groupOrder
  groupsRef.current = groups
  itemsRef.current = items

  const addCategory = useCallback((): string => {
    const order = groupOrderRef.current
    let index = order.length + 1
    let candidate = `Kategori ${index}`
    while (order.includes(candidate)) {
      index += 1
      candidate = `Kategori ${index}`
    }

    setEmptyGroups((prev) => [...prev, candidate])
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.delete(candidate)
      return next
    })

    return candidate
  }, [])

  const removeCategory = useCallback(
    (group: string) => {
      const groupItems = groupsRef.current[group] || []
      if (groupItems.length > 0) {
        const confirmed = window.confirm(
          `Kategorien «${group}» inneholder ${groupItems.length} linje${groupItems.length === 1 ? "" : "r"}. Vil du fjerne kategorien og alle linjene?`
        )
        if (!confirmed) return
      }

      onItemsChange(itemsRef.current.filter((item) => normalizeGroupName(item.subproject) !== group))
      setEmptyGroups((prev) => prev.filter((entry) => entry !== group))
      setCollapsedGroups((prev) => {
        const next = new Set(prev)
        next.delete(group)
        return next
      })
    },
    [onItemsChange]
  )

  useImperativeHandle(
    ref,
    (): NewOfferItemsTableHandle => ({
      addCategory,
      removeCategory,
      getCategories: () => groupOrderRef.current,
    }),
    [addCategory, removeCategory]
  )

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return

    const sourceGroup = result.source.droppableId
    const destinationGroup = result.destination.droppableId
    const sourceIndex = result.source.index
    const destinationIndex = result.destination.index

    if (sourceGroup === destinationGroup && sourceIndex === destinationIndex) return

    const nextItems =
      sourceGroup === destinationGroup
        ? reorderItemsInGroup(items, sourceGroup, sourceIndex, destinationIndex)
        : moveItemBetweenGroups(items, sourceGroup, destinationGroup, sourceIndex, destinationIndex)

    onItemsChange(nextItems)
    setEmptyGroups((prev) => prev.filter((group) => group !== destinationGroup || (groups[group]?.length || 0) > 0))
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border bg-background">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-8" />
              <TableHead className="w-[33%] text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Produkt / element
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leverandør</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enhetspris</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Antall</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enhet</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Påslag</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rabatt</TableHead>
              <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Linjesum
              </TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>

          <DragDropContext onDragEnd={handleDragEnd}>
            {groupOrder.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell colSpan={10} className="h-20 text-center text-sm text-muted-foreground">
                    Ingen elementer enda. Legg til fra prisliste, fast jobb eller blank rad.
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              groupOrder.map((group) => {
                const groupItems = groups[group] || []
                const isExpanded = !collapsedGroups.has(group)

                return (
                  <Fragment key={group}>
                    <TableBody>
                      <TableRow className="bg-muted/50 hover:bg-muted/70">
                        <TableCell colSpan={10} className="py-2">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
                              onClick={() => toggleGroup(group)}
                              aria-label={isExpanded ? "Skjul kategori" : "Vis kategori"}
                            >
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                                  !isExpanded && "-rotate-90"
                                )}
                              />
                            </button>
                            <EditableText
                              value={group}
                              onChange={(nextName) => renameGroup(group, nextName)}
                              placeholder="Kategorinavn"
                              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                              onClick={(event) => event.stopPropagation()}
                            />
                            <Badge variant="outline" className="ml-0.5 h-4 rounded-sm px-1.5 text-[10px] font-normal">
                              {groupItems.length}
                            </Badge>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => removeCategory(group)}
                              aria-label={`Fjern kategori ${group}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    </TableBody>

                    {isExpanded ? (
                      <Droppable droppableId={group}>
                        {(provided, snapshot) => (
                          <tbody
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={cn("[&_tr:last-child]:border-0", snapshot.isDraggingOver && "bg-primary/5")}
                          >
                            {groupItems.length === 0 ? (
                              <tr>
                                <td colSpan={10} className="p-2 align-middle">
                                  <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                                    Dra komponenter hit eller legg til nye linjer i denne kategorien.
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              groupItems.map((item, index) => (
                                <Draggable key={item.id} draggableId={item.id} index={index}>
                                  {(dragProvided, dragSnapshot) => (
                                    <tr
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      className={cn(
                                        "group/row border-b transition-colors hover:bg-muted/20 data-[state=selected]:bg-muted",
                                        dragSnapshot.isDragging && "bg-muted/40 shadow-sm"
                                      )}
                                    >
                                      <td className="w-8 p-2 align-middle">
                                        <button
                                          type="button"
                                          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                          {...dragProvided.dragHandleProps}
                                          aria-label="Dra komponent"
                                        >
                                          <GripVertical className="h-3.5 w-3.5" />
                                        </button>
                                      </td>
                                      <td className="p-2 align-middle">
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
                                                window.open(
                                                  `https://nobb.no/item/${encodeURIComponent(nobb)}`,
                                                  "_blank",
                                                  "noopener,noreferrer"
                                                )
                                              }}
                                              aria-label={`Åpne NOBB ${resolveNobb(item)}`}
                                            >
                                              <ExternalLink className="h-3.5 w-3.5" />
                                            </Button>
                                          ) : null}
                                        </div>
                                      </td>
                                      <td className="p-2 align-middle">
                                        <EditableSelect
                                          value={item.supplier ?? ""}
                                          onChange={(v) => updateRow(item.id, { supplier: v })}
                                          options={supplierSuggestions}
                                          placeholder="Velg prisliste"
                                        />
                                      </td>
                                      <td className="p-2 align-middle">
                                        <EditableNumber
                                          value={item.unitPriceNok}
                                          onChange={(v) => updateRow(item.id, { unitPriceNok: v })}
                                          format={(v) =>
                                            v.toLocaleString("no-NO", {
                                              minimumFractionDigits: 0,
                                              maximumFractionDigits: 2,
                                            }) + " kr"
                                          }
                                          min={0}
                                          step={0.01}
                                          className="w-28"
                                        />
                                      </td>
                                      <td className="p-2 align-middle">
                                        <EditableNumber
                                          value={item.quantity}
                                          onChange={(v) => updateRow(item.id, { quantity: v })}
                                          min={0}
                                          step={1}
                                          className="w-16"
                                        />
                                      </td>
                                      <td className="p-2 align-middle">
                                        <EditableText
                                          value={item.unit}
                                          onChange={(v) => updateRow(item.id, { unit: v })}
                                          placeholder="stk"
                                          className="w-14 text-muted-foreground"
                                        />
                                      </td>
                                      <td className="p-2 align-middle">
                                        <EditableNumber
                                          value={item.markupPercent}
                                          onChange={(v) => updateRow(item.id, { markupPercent: v })}
                                          format={(v) => v + "%"}
                                          min={0}
                                          max={100}
                                          step={0.1}
                                          className="w-16"
                                        />
                                      </td>
                                      <td className="p-2 align-middle">
                                        <EditableNumber
                                          value={item.discountPercent}
                                          onChange={(v) => updateRow(item.id, { discountPercent: v })}
                                          format={(v) => v + "%"}
                                          min={0}
                                          max={100}
                                          step={0.1}
                                          className="w-16"
                                        />
                                      </td>
                                      <td className="p-2 text-right align-middle tabular-nums text-sm font-semibold text-foreground">
                                        {formatNok(calculateLineItemTotal(item))}
                                      </td>
                                      <td className="w-8 p-2 align-middle">
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
                                      </td>
                                    </tr>
                                  )}
                                </Draggable>
                              ))
                            )}
                            {provided.placeholder}
                          </tbody>
                        )}
                      </Droppable>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </DragDropContext>
        </Table>
      </div>
    </div>
  )
})

NewOfferItemsTable.displayName = "NewOfferItemsTable"
