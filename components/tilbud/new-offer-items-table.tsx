"use client"

import { useCallback, useMemo } from "react"
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { calculateLineItemTotal, formatNok, type OfferLineItem } from "@/lib/tilbud/types"

type NewOfferItemsTableProps = {
  items: OfferLineItem[]
  onItemsChange: (next: OfferLineItem[]) => void
  subprojectSuggestions: string[]
}

function parseNumber(value: string, fallback: number) {
  const parsed = Number(value.replace(",", "."))
  return Number.isFinite(parsed) ? parsed : fallback
}

export function NewOfferItemsTable({
  items,
  onItemsChange,
  subprojectSuggestions,
}: NewOfferItemsTableProps) {
  const updateRow = useCallback(
    (rowIndex: number, patch: Partial<OfferLineItem>) => {
      const next = items.map((item, index) => (index === rowIndex ? { ...item, ...patch } : item))
      onItemsChange(next)
    },
    [items, onItemsChange]
  )

  const removeRow = useCallback(
    (rowIndex: number) => {
      const next = items.filter((_, index) => index !== rowIndex)
      onItemsChange(next)
    },
    [items, onItemsChange]
  )

  const addRow = () => {
    const firstSubproject = subprojectSuggestions[0] || "Generelt"
    const next: OfferLineItem = {
      id: crypto.randomUUID(),
      subproject: firstSubproject,
      title: "",
      description: "",
      quantity: 1,
      unit: "stk",
      supplier: "",
      unitPriceNok: 0,
      markupPercent: 15,
      discountPercent: 0,
    }

    onItemsChange([...items, next])
  }

  const columns = useMemo<ColumnDef<OfferLineItem>[]>(
    () => [
      {
        accessorKey: "subproject",
        header: "Delprosjekt",
        cell: ({ row }) => (
          <>
            <Input
              list="subproject-suggestions"
              value={row.original.subproject}
              onChange={(event) => updateRow(row.index, { subproject: event.target.value })}
              placeholder="Eks: Bad"
            />
            <datalist id="subproject-suggestions">
              {subprojectSuggestions.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </>
        ),
      },
      {
        accessorKey: "title",
        header: "Produkt / element",
        cell: ({ row }) => (
          <Input
            value={row.original.title}
            onChange={(event) => updateRow(row.index, { title: event.target.value })}
            placeholder="Navn"
          />
        ),
      },
      {
        accessorKey: "description",
        header: "Beskrivelse",
        cell: ({ row }) => (
          <Textarea
            rows={2}
            value={row.original.description}
            onChange={(event) => updateRow(row.index, { description: event.target.value })}
            placeholder="Kort beskrivelse"
            className="min-w-[220px]"
          />
        ),
      },
      {
        accessorKey: "quantity",
        header: "Antall",
        cell: ({ row }) => (
          <Input
            type="number"
            min={0}
            value={row.original.quantity}
            onChange={(event) => updateRow(row.index, { quantity: parseNumber(event.target.value, row.original.quantity) })}
            className="w-24"
          />
        ),
      },
      {
        accessorKey: "unit",
        header: "Enhet",
        cell: ({ row }) => (
          <Input
            value={row.original.unit}
            onChange={(event) => updateRow(row.index, { unit: event.target.value })}
            className="w-20"
          />
        ),
      },
      {
        accessorKey: "supplier",
        header: "Leverandør",
        cell: ({ row }) => (
          <Input
            value={row.original.supplier}
            onChange={(event) => updateRow(row.index, { supplier: event.target.value })}
            className="min-w-[140px]"
          />
        ),
      },
      {
        accessorKey: "unitPriceNok",
        header: "Pris",
        cell: ({ row }) => (
          <Input
            type="number"
            min={0}
            step="0.01"
            value={row.original.unitPriceNok}
            onChange={(event) =>
              updateRow(row.index, {
                unitPriceNok: parseNumber(event.target.value, row.original.unitPriceNok),
              })
            }
            className="w-28"
          />
        ),
      },
      {
        accessorKey: "markupPercent",
        header: "Påslag %",
        cell: ({ row }) => (
          <Input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={row.original.markupPercent}
            onChange={(event) =>
              updateRow(row.index, {
                markupPercent: parseNumber(event.target.value, row.original.markupPercent),
              })
            }
            className="w-24"
          />
        ),
      },
      {
        accessorKey: "discountPercent",
        header: "Rabatt %",
        cell: ({ row }) => (
          <Input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={row.original.discountPercent}
            onChange={(event) =>
              updateRow(row.index, {
                discountPercent: parseNumber(event.target.value, row.original.discountPercent),
              })
            }
            className="w-24"
          />
        ),
      },
      {
        id: "lineTotal",
        header: "Linjesum",
        cell: ({ row }) => (
          <p className="min-w-[90px] text-sm font-semibold text-foreground">{formatNok(calculateLineItemTotal(row.original))}</p>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => removeRow(row.index)}
            aria-label="Fjern rad"
          >
            <Trash2 className="size-4" />
          </Button>
        ),
      },
    ],
    [removeRow, subprojectSuggestions, updateRow]
  )

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-background shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="bg-muted/40 hover:bg-muted/40">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/30">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="align-top py-2">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-20 text-center text-muted-foreground">
                    Ingen elementer enda. Start med analyse eller legg til manuelt.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Button type="button" variant="outline" onClick={addRow}>
        <Plus className="mr-2 size-4" />
        Legg til rad
      </Button>
    </div>
  )
}
