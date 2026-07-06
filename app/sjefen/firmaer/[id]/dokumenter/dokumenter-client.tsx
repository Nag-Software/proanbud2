"use client"

import { ColumnDef } from "@tanstack/react-table"
import { DownloadIcon, FolderIcon } from "lucide-react"

import { AdminDataTable } from "@/components/sjefen/admin-data-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CompanyDocumentRow } from "@/lib/platform/company-content"
import { documentProviderLabels, formatBytes, formatDate } from "@/lib/sjefen/format"

function typeLabel(row: CompanyDocumentRow) {
  if (row.item_type === "folder") return "Mappe"
  return row.extension?.toUpperCase() ?? row.mime_type ?? "Fil"
}

const columns: ColumnDef<CompanyDocumentRow>[] = [
  {
    accessorKey: "name",
    header: "Navn",
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2 font-medium">
        {row.original.item_type === "folder" && (
          <FolderIcon className="size-4 text-muted-foreground" />
        )}
        {row.original.name}
      </span>
    ),
  },
  {
    id: "type",
    header: "Type",
    cell: ({ row }) => typeLabel(row.original),
  },
  {
    accessorKey: "size_bytes",
    header: "Størrelse",
    cell: ({ row }) =>
      row.original.item_type === "folder" ? "—" : formatBytes(row.original.size_bytes),
  },
  {
    accessorKey: "owner_name",
    header: "Eier",
  },
  {
    accessorKey: "provider",
    header: "Kilde",
    cell: ({ row }) =>
      documentProviderLabels[row.original.provider] ?? row.original.provider,
  },
  {
    accessorKey: "updated_at",
    header: "Endret",
    cell: ({ row }) => formatDate(row.original.updated_at),
  },
  {
    id: "actions",
    header: "Handling",
    cell: ({ row }) =>
      row.original.item_type === "file" ? (
        <a
          href={`/api/sjefen/dokumenter/${row.original.id}/download`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
          onClick={(event) => event.stopPropagation()}
        >
          Last ned
          <DownloadIcon className="size-3.5" />
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
]

export function CompanyDocumentsClient({ documents }: { documents: CompanyDocumentRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dokumenter ({documents.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <AdminDataTable
          columns={columns}
          data={documents}
          searchColumn="name"
          searchPlaceholder="Søk dokument..."
          renderMobileRow={(row) => (
            <div className="space-y-1">
              <p className="font-medium">{row.name}</p>
              <p className="text-sm text-muted-foreground">
                {typeLabel(row)} · {row.item_type === "folder" ? "—" : formatBytes(row.size_bytes)}{" "}
                · {row.owner_name}
              </p>
              {row.item_type === "file" && (
                <a
                  href={`/api/sjefen/dokumenter/${row.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm underline underline-offset-4"
                >
                  Last ned
                  <DownloadIcon className="size-3.5" />
                </a>
              )}
            </div>
          )}
        />
      </CardContent>
    </Card>
  )
}
