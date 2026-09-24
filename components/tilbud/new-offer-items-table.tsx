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
import { ChevronDown, ExternalLink, GripVertical, Info, Pencil, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"
import {
  calculateLineItemTotal,
  calculateLineItemUnitPriceWithMarkupBeforeDiscount,
  formatNok,
  type OfferLineItem,
} from "@/lib/tilbud/types"
import { isHourUnit } from "@/lib/job-costing/calc"
import { formatDocumentQuantity, formatDocumentUnit } from "@/lib/tilbud/offer-document"
import { toast } from "sonner"
import {
  INCOME_ACCOUNT_CATEGORY_OPTIONS,
  effectiveIncomeAccountCategory,
  type IncomeAccountCategory,
} from "@/lib/tilbud/income-accounts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type NewOfferItemsTableProps = {
  items: OfferLineItem[]
  onItemsChange: (next: OfferLineItem[]) => void
  supplierSuggestions: string[]
  /**
   * Kalles når en kategori omdøpes (`to` = nytt navn) eller fjernes (`to` = null).
   * Forelderen husker «aktiv kategori» for nye linjer og må følge med — ellers
   * havner neste «Blank rad» i en gjenoppstått kategori med det gamle navnet.
   */
  onCategoryChange?: (from: string, to: string | null) => void
}

export type NewOfferItemsTableHandle = {
  addCategory: () => string
  removeCategory: (group: string) => void
  getCategories: () => string[]
  /** Åpner redigeringsarket for raden i kortvisningen (mobil/nettbrett), med markøren i navnefeltet. Gjør ingenting når tabellen vises. */
  editItem: (item: OfferLineItem) => void
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

/**
 * Intern kvalitetsmerking: prisen har ingen dekning i bedriftens prisfiler eller
 * lagrede jobber, så den er KI-ens eget anslag. Vises kun her i redigeringen —
 * aldri i kundens tilbudsdokument. `undefined` (linjer fra før feltet fantes)
 * merkes ikke: vi vet ikke hvor prisen kom fra, og skal ikke påstå at den er gjettet.
 */
function PriceSourceBadge({ item }: { item: OfferLineItem }) {
  if (item.priceSource !== "anslag") return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="shrink-0 cursor-default border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:text-amber-400"
        >
          Anslag
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        Prisen er KI-ens eget anslag — den er ikke funnet i prisfilene dine. Kontroller den før du sender tilbudet.
      </TooltipContent>
    </Tooltip>
  )
}

function LineItemInfoButton({ item }: { item: OfferLineItem }) {
  const reasoning = item.reasoning?.trim()
  const description = item.description?.trim()
  const hasContent = Boolean(reasoning || description)

  if (!hasContent) return null

  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`Begrunnelse for ${item.title}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="px-4 md:p-4 sm:max-w-md">
        <ResponsiveDialogHeader className="px-0">
          <ResponsiveDialogTitle>{item.title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Begrunnelse for valg av produkt, pris og mengde.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-3 pb-4 text-sm md:pb-0">
          {reasoning ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Begrunnelse</p>
              <p className="leading-relaxed text-foreground">{reasoning}</p>
            </div>
          ) : null}
          {description ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Innhold</p>
              <p className="whitespace-pre-line leading-relaxed text-foreground">{description}</p>
            </div>
          ) : null}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
  inputMode,
}: {
  value: number
  onChange: (v: number) => void
  format?: (v: number) => string
  min?: number
  max?: number
  step?: number
  className?: string
  inputMode?: "numeric" | "decimal"
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
        inputMode={inputMode}
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

const QUICK_UNITS = [
  { value: "timer", label: "timer" },
  { value: "stk", label: "stk" },
  { value: "m2", label: "m²" },
  { value: "lm", label: "lm" },
] as const

function formatUnitPrice(value: number) {
  const safe = Number.isFinite(value) ? value : 0
  const decimals = Number.isInteger(Math.round(safe * 100) / 100) ? 0 : 2
  return `${new Intl.NumberFormat("nb-NO", { minimumFractionDigits: decimals, maximumFractionDigits: 2 }).format(safe)} kr`
}

/** Entall etter «per»: «per time», «per m²». */
function perUnitLabel(unit: string) {
  return isHourUnit(unit) ? "time" : formatDocumentUnit(unit || "stk")
}

/** «16 timer × 650 kr + 15 % påslag» — hele regnestykket bak linjesummen. */
function describeLineItemPrice(item: OfferLineItem) {
  const base = `${formatDocumentQuantity(item.quantity)} ${formatDocumentUnit(item.unit || "stk")}`
  const parts = [item.unitPriceNok > 0 ? `${base} × ${formatUnitPrice(item.unitPriceNok)}` : base]
  if (item.markupPercent > 0) parts.push(`+ ${formatDocumentQuantity(item.markupPercent)} % påslag`)
  if (item.discountPercent > 0) parts.push(`− ${formatDocumentQuantity(item.discountPercent)} % rabatt`)
  return parts.join(" ")
}

export const NewOfferItemsTable = forwardRef<NewOfferItemsTableHandle, NewOfferItemsTableProps>(function NewOfferItemsTable(
  { items, onItemsChange, supplierSuggestions, onCategoryChange },
  ref
) {
  const confirm = useConfirm()
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [emptyGroups, setEmptyGroups] = useState<string[]>([])
  const [editingItem, setEditingItem] = useState<OfferLineItem | null>(null)
  // En ny rad skal få navnet sitt skrevet inn med en gang. En eksisterende rad åpnes
  // uten tastatur, så feltene man oftest endrer (antall, pris) ikke dekkes til.
  const focusTitleOnOpenRef = useRef(false)

  const groups = useMemo(() => buildGroups(items), [items])

  const groupOrder = useMemo(() => {
    const existing = Object.keys(groups)
    const extras = emptyGroups.filter((group) => !existing.includes(group))
    return [...existing, ...extras]
  }, [emptyGroups, groups])

  const updateRow = useCallback(
    (id: string, patch: Partial<OfferLineItem>) => {
      onItemsChange(
        items.map((item) => {
          if (item.id !== id) return item
          const next = { ...item, ...patch }
          // Retter håndverkeren prisen selv, er den ikke lenger KI-ens anslag.
          // Uten dette ville «Anslag»-merket blitt stående etter at feilen er rettet.
          if (
            patch.unitPriceNok !== undefined &&
            patch.unitPriceNok !== item.unitPriceNok &&
            item.priceSource === "anslag"
          ) {
            next.priceSource = undefined
          }
          return next
        })
      )
    },
    [items, onItemsChange]
  )

  const removeRow = useCallback(
    (id: string) => {
      onItemsChange(items.filter((item) => item.id !== id))
    },
    [items, onItemsChange]
  )

  // Mobil: sletting er ett trykk unna, så den kan angres i et par sekunder.
  const removeRowWithUndo = (removed: OfferLineItem) => {
    const index = items.findIndex((item) => item.id === removed.id)
    onItemsChange(items.filter((item) => item.id !== removed.id))
    toast("Linjen er slettet", {
      action: {
        label: "Angre",
        onClick: () => {
          const current = itemsRef.current
          if (current.some((item) => item.id === removed.id)) return
          const next = [...current]
          next.splice(Math.min(Math.max(index, 0), next.length), 0, removed)
          onItemsChange(next)
        },
      },
    })
  }

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
      onCategoryChange?.(oldName, nextName)
    },
    [items, onItemsChange, onCategoryChange]
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
    async (group: string) => {
      const groupItems = groupsRef.current[group] || []
      if (groupItems.length > 0) {
        const confirmed = await confirm({
          title: "Fjerne kategori?",
          description: `Kategorien «${group}» inneholder ${groupItems.length} linje${groupItems.length === 1 ? "" : "r"}. Kategorien og alle linjene i den fjernes fra tilbudet.`,
          confirmText: "Fjern kategori",
          cancelText: "Avbryt",
          variant: "destructive",
        })
        if (!confirmed) return
      }

      onItemsChange(itemsRef.current.filter((item) => normalizeGroupName(item.subproject) !== group))
      setEmptyGroups((prev) => prev.filter((entry) => entry !== group))
      setCollapsedGroups((prev) => {
        const next = new Set(prev)
        next.delete(group)
        return next
      })
      onCategoryChange?.(group, null)
    },
    [confirm, onItemsChange, onCategoryChange]
  )

  useImperativeHandle(
    ref,
    (): NewOfferItemsTableHandle => ({
      addCategory,
      removeCategory,
      getCategories: () => groupOrderRef.current,
      editItem: (item) => {
        // Arket hører til kortvisningen (under lg); med tabellen redigeres raden direkte i den.
        if (!window.matchMedia("(max-width: 1023px)").matches) return
        focusTitleOnOpenRef.current = true
        setEditingItem({ ...item })
      },
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
    <>
    <div className="hidden w-full overflow-hidden rounded-lg border bg-background lg:block">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-8" />
              <TableHead className="w-[26%] max-w-md text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Produkt / element
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Leverandør</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enhetspris</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Antall</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enhet</TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center gap-1">
                      Påslag
                      <Info className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Prosent lagt på innkjøpsprisen — dette er fortjenesten din på varen.</TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center gap-1">
                      Rabatt
                      <Info className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Prosent trukket fra prisen kunden ser.</TooltipContent>
                </Tooltip>
              </TableHead>
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
                                      <td className="max-w-md p-2 align-middle">
                                        <div className="flex items-center gap-1">
                                          <div className="min-w-0 flex-1">
                                            <EditableText
                                              value={item.title}
                                              onChange={(v) => updateRow(item.id, { title: v })}
                                              placeholder="Produktnavn..."
                                              className="font-medium"
                                            />
                                          </div>
                                          <PriceSourceBadge item={item} />
                                          <LineItemInfoButton item={item} />
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
                                          inputMode="decimal"
                                          className="w-28"
                                        />
                                      </td>
                                      <td className="p-2 align-middle">
                                        <EditableNumber
                                          value={item.quantity}
                                          onChange={(v) => updateRow(item.id, { quantity: v })}
                                          min={0}
                                          step={1}
                                          inputMode="numeric"
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
                                          inputMode="decimal"
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
    <div className="space-y-2 lg:hidden">
      {groupOrder.length === 0 ? (
        <div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
          Ingen linjer ennå. Bruk «Legg til» for å hente fra prislisten, legge inn arbeidstimer eller en blank rad.
        </div>
      ) : (
        groupOrder.map((group) => {
          const groupItems = groups[group] || []
          const isExpanded = !collapsedGroups.has(group)
          const groupTotal = groupItems.reduce((sum, item) => sum + calculateLineItemTotal(item), 0)

          return (
            <div key={group} className="overflow-hidden rounded-lg border bg-background">
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 bg-muted/50 px-3 py-2.5 text-left"
                onClick={() => toggleGroup(group)}
                aria-expanded={isExpanded}
                aria-label={isExpanded ? `Skjul ${group}` : `Vis ${group}`}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
                    !isExpanded && "-rotate-90"
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </span>
                <Badge variant="outline" className="h-4 rounded-sm px-1.5 text-[10px] font-normal">
                  {groupItems.length}
                </Badge>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatNok(groupTotal)}</span>
              </button>

              {isExpanded ? (
                groupItems.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    Ingen linjer i denne kategorien.
                  </div>
                ) : (
                  <div className="divide-y">
                    {groupItems.map((item) => (
                      <div key={item.id} className="flex items-stretch">
                        {/* Hele kortet er trykkflaten for redigering — lettere å treffe enn et lite blyantikon. */}
                        <button
                          type="button"
                          className="min-w-0 flex-1 py-3 pl-3 pr-1 text-left transition-colors active:bg-muted/60"
                          onClick={() => {
                            focusTitleOnOpenRef.current = false
                            setEditingItem({ ...item })
                          }}
                          aria-label={`Rediger ${item.title || "linje"}`}
                        >
                          <span className="flex items-start gap-3">
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium leading-snug">{item.title || "Uten navn"}</span>
                              {item.description ? (
                                <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                                  {item.description}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">
                              {formatNok(calculateLineItemTotal(item))}
                            </span>
                          </span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>{describeLineItemPrice(item)}</span>
                            <PriceSourceBadge item={item} />
                            <Pencil className="size-3 opacity-60" aria-hidden="true" />
                          </span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mr-1 size-10 self-center text-muted-foreground hover:text-destructive"
                          onClick={() => removeRowWithUndo(item)}
                          aria-label={`Slett ${item.title || "linje"}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )
              ) : null}
            </div>
          )
        })
      )}
    </div>

    {/* Mobil redigering */}
    <Sheet open={editingItem !== null} onOpenChange={(open) => { if (!open) setEditingItem(null) }}>
      <SheetContent
        side="bottom"
        className="h-auto max-h-[90vh] overflow-y-auto rounded-t-xl px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        onOpenAutoFocus={(event) => {
          if (focusTitleOnOpenRef.current) return
          // Fokus på selve arket: skjermlesere havner i dialogen, men tastaturet blir nede.
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
      >
        <SheetHeader className="mb-2 px-0">
          <SheetTitle className="text-base">Rediger linje</SheetTitle>
        </SheetHeader>
        {editingItem && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="line-edit-title" className="text-xs text-muted-foreground">Navn</Label>
              <Input
                id="line-edit-title"
                value={editingItem.title}
                onChange={(e) => setEditingItem((prev) => prev ? { ...prev, title: e.target.value } : null)}
                placeholder="F.eks. Flislegging vegg"
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="line-edit-quantity" className="text-xs text-muted-foreground">Antall</Label>
                <Input
                  id="line-edit-quantity"
                  type="number"
                  inputMode="decimal"
                  value={editingItem.quantity}
                  onChange={(e) => setEditingItem((prev) => prev ? { ...prev, quantity: parseNumber(e.target.value, prev.quantity) } : null)}
                  min={0}
                  step="any"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line-edit-unit" className="text-xs text-muted-foreground">Enhet</Label>
                <Input
                  id="line-edit-unit"
                  value={editingItem.unit}
                  onChange={(e) => setEditingItem((prev) => prev ? { ...prev, unit: e.target.value } : null)}
                  placeholder="stk"
                  className="h-11"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vanlige enheter">
              {QUICK_UNITS.map((unit) => {
                // Normalisert: «time» fra Arbeidstimer og «M2»/«m²» skal også markere riktig brikke.
                const active =
                  unit.value === "timer"
                    ? isHourUnit(editingItem.unit)
                    : formatDocumentUnit(editingItem.unit.trim().toLowerCase()) === formatDocumentUnit(unit.value)
                return (
                  <button
                    key={unit.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setEditingItem((prev) => prev ? { ...prev, unit: unit.value } : null)}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                      active ? "border-foreground bg-foreground text-background" : "text-muted-foreground"
                    )}
                  >
                    {unit.label}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="line-edit-price" className="text-xs text-muted-foreground">
                  {isHourUnit(editingItem.unit) ? "Timepris (kr)" : "Innkjøpspris (kr)"}
                </Label>
                <Input
                  id="line-edit-price"
                  type="number"
                  inputMode="decimal"
                  value={editingItem.unitPriceNok}
                  onChange={(e) => setEditingItem((prev) => prev ? { ...prev, unitPriceNok: parseNumber(e.target.value, prev.unitPriceNok) } : null)}
                  min={0}
                  step="any"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="line-edit-markup" className="text-xs text-muted-foreground">Påslag (%)</Label>
                <Input
                  id="line-edit-markup"
                  type="number"
                  inputMode="decimal"
                  value={editingItem.markupPercent}
                  onChange={(e) => setEditingItem((prev) => prev ? { ...prev, markupPercent: parseNumber(e.target.value, prev.markupPercent) } : null)}
                  min={0}
                  step="any"
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="line-edit-discount" className="text-xs text-muted-foreground">Rabatt til kunden (%)</Label>
              <Input
                id="line-edit-discount"
                type="number"
                inputMode="decimal"
                value={editingItem.discountPercent}
                onChange={(e) => setEditingItem((prev) => prev ? { ...prev, discountPercent: parseNumber(e.target.value, prev.discountPercent) } : null)}
                min={0}
                max={100}
                step="any"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Inntektskonto (regnskap)</Label>
              <Select
                value={effectiveIncomeAccountCategory(editingItem)}
                onValueChange={(value) =>
                  setEditingItem((prev) =>
                    prev ? { ...prev, incomeAccountCategory: value as IncomeAccountCategory } : null
                  )
                }
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INCOME_ACCOUNT_CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">
                {editingItem.incomeAccountCategory
                  ? "Valgt manuelt."
                  : "Foreslått ut fra enhet og leverandør."}{" "}
                Styrer hvilken konto salget føres på.
              </p>
            </div>
            <div className="space-y-1 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-3 text-muted-foreground">
                <span>Pris til kunde per {perUnitLabel(editingItem.unit)}</span>
                <span className="tabular-nums">
                  {formatUnitPrice(calculateLineItemUnitPriceWithMarkupBeforeDiscount(editingItem))}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">Linjesum eks. mva</span>
                <span className="font-semibold tabular-nums">{formatNok(calculateLineItemTotal(editingItem))}</span>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="lg"
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setEditingItem(null)}
              >
                Avbryt
              </Button>
              <Button size="lg"
                type="button"
                className="flex-1"
                onClick={() => {
                  if (editingItem) {
                    updateRow(editingItem.id, editingItem)
                    setEditingItem(null)
                  }
                }}
              >
                Lagre
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
    </>
  )
})

NewOfferItemsTable.displayName = "NewOfferItemsTable"
