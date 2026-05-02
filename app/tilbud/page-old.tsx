"use client"

import { AppPageShell } from "@/components/app-page-shell"
import { Button } from "@/components/ui/button"
import { DataTableSearchSection, DataTableSection, useDataTable } from "@/components/ui/datatable"
import { PlusCircle } from "lucide-react"

export default function Page() {
    const data: any[] = []

    const {
        searchTerm,
        setSearchTerm,
        sortConfig,
        handleSort,
        data: sortedData,
    } = useDataTable(data)

    return (
        <AppPageShell segments={["Mine Tilbud"]}>
            <div className="flex items-center h-10 mt-5">
                <DataTableSearchSection 
                    searchPlaceholder="Søk etter tilbud..."
                    searchTerm={searchTerm}
                    onSearchChange={setSearchTerm}
                    enableFiltering={false}
                />

                <Button variant="default" className="ml-2 h-10 px-3">
                    <PlusCircle className="ml-1 h-3 w-3" />
                    Nytt Tilbud
                </Button>
            </div>
            <DataTableSection
                columns={[
                    { header: "Kunde", accessorKey: "kunde", weight: "semibold"},
                    { header: "Prosjekt", accessorKey: "prosjekt" },
                    { header: "Total", accessorKey: "total", weight: "semibold" },
                    { header: "Profitt", accessorKey: "profitt" },
                    { header: "Status", accessorKey: "status"},
                    { header: "Dato", accessorKey: "createdAt" },
                    {
                        header: "Handlinger",
                        accessorKey: "actions",
                        cell: ({ row }) => {
                            const status = row.original.status

                            if (status === "utkast") {
                                return (
                                    <Button
                                        className="inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-0 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        type="button"
                                    >
                                        Send
                                    </Button>
                                )
                            }

                            if (status === "venter") {
                                return (
                                    <div className="flex items-center gap-2">
                                        <Button
                                            className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                                            type="button"
                                        >
                                            Aksepter
                                        </Button>
                                        <Button
                                            className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-2 py-0 text-xs font-medium text-rose-700 hover:bg-rose-100"
                                            type="button"
                                        >
                                            Avvis
                                        </Button>
                                    </div>
                                )
                            }

                            return null
                        },
                    },
                ]}
                data={sortedData}
                compactOnMobile={true}
                maxHeight="fit-content"
                sortConfig={sortConfig}
                onSort={handleSort}
            />
        </AppPageShell>
    )
}