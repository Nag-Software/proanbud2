"use client"

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { useRouter } from "next/navigation"
import { type Quota, offerStatusConfigByValue } from "./columns"
import { cn } from "@/lib/utils"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
}

export function DataTable<TData, TValue>({
  columns,
  data,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const router = useRouter();

  return (
    <div className="w-full min-w-0 max-w-full">
      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-md border text-sm md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="cursor-pointer hover:bg-muted/50 active:bg-muted transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/tilbud/${(row.original as { id: string }).id}`)}
                    >
                      {cell.column.id === "amount"
                        ? (cell.getContext().getValue() as number).toLocaleString() + " kr"
                        : flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Ingen tilbud funnet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card view */}
      <div className="divide-y overflow-hidden rounded-md border md:hidden">
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => {
            const original = row.original as Quota
            const statusConfig = offerStatusConfigByValue[original.status]
            return (
              <div
                key={row.id}
                className="cursor-pointer px-4 py-3 hover:bg-muted/50 active:bg-muted/70 transition-colors"
                onClick={() => router.push(`/tilbud/${original.id}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{original.project || original.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground truncate">{original.customer}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{original.created}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold tabular-nums">{original.amount.toLocaleString("no-NO")} kr</p>
                    <div className="mt-1 flex items-center justify-end gap-1">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <span
                          key={i}
                          className={cn("h-2 w-4 rounded-sm bg-muted", i < statusConfig.filledBars && statusConfig.fillClass)}
                        />
                      ))}
                      <span className="ml-1 text-[10px] text-muted-foreground">{statusConfig.label}</span>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Ingen tilbud funnet.</div>
        )}
      </div>
    </div>
  )
}
