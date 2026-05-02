"use client"

import { useMemo, useState } from "react"
import { CheckCircle, FileText, Send, Wallet } from "lucide-react"

import { columns, type Quota } from "@/components/tilbud/columns"
import { DataTable } from "@/components/tilbud/data-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

type OfferRow = {
    id: string
    title?: string | null
    description?: string | null
    amount_nok?: number | null
    status?: string | null
    created_at?: string | null
}

type TilbudTabProps = {
    projectId: string
    projectName: string
    customerName: string
    offers: OfferRow[]
}

type SortOption = "newest" | "oldest" | "amount_desc" | "amount_asc"

function formatDisplayDate(value?: string | null) {
    if (!value) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return date.toLocaleDateString("no-NO", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    })
}

function normalizeStatus(value?: string | null): Quota["status"] {
    if (value === "sent" || value === "accepted" || value === "rejected" || value === "draft") {
        return value
    }
    return "draft"
}

export default function TilbudTab({ projectId, projectName, customerName, offers }: TilbudTabProps) {
    const [search, setSearch] = useState("")
    const [sortBy, setSortBy] = useState<SortOption>("newest")

    const tableData = useMemo(() => {
        return offers.map((item) => {
            const createdRaw = item.created_at || ""
            const amount = Number(item.amount_nok || 0)

            return {
                id: item.id,
                customer: customerName || "Ukjent kunde",
                project: projectName || "Ikke tilknyttet prosjekt",
                description: item.description || item.title || "Ingen beskrivelse",
                created: formatDisplayDate(item.created_at),
                createdRaw,
                amount,
                email: "",
                settings: "",
                status: normalizeStatus(item.status),
            }
        })
    }, [customerName, offers, projectName])

    const visibleData = useMemo(() => {
        const needle = search.trim().toLowerCase()

        let filtered = tableData
        if (needle) {
            filtered = tableData.filter((item) => {
                const haystack = `${item.id} ${item.customer} ${item.project} ${item.description} ${item.status}`.toLowerCase()
                return haystack.includes(needle)
            })
        }

        const sorted = [...filtered]
        sorted.sort((a, b) => {
            if (sortBy === "newest") {
                return new Date(b.createdRaw).getTime() - new Date(a.createdRaw).getTime()
            }

            if (sortBy === "oldest") {
                return new Date(a.createdRaw).getTime() - new Date(b.createdRaw).getTime()
            }

            if (sortBy === "amount_desc") {
                return b.amount - a.amount
            }

            return a.amount - b.amount
        })

        return sorted.map(({ createdRaw: _createdRaw, ...quota }) => quota as Quota)
    }, [search, sortBy, tableData])

    const totalOffers = tableData.length
    const sentOffers = tableData.filter((d) => d.status === "sent")
    const sentCount = sentOffers.length

    const approvedOffers = tableData.filter((d) => d.status === "accepted")
    const approvedCount = approvedOffers.length
    const approvedValue = approvedOffers.reduce((sum, d) => sum + (d.amount || 0), 0)

    const formatNOK = (amount: number) => {
        return new Intl.NumberFormat("no-NO", {
            style: "currency",
            currency: "NOK",
            maximumFractionDigits: 0,
        }).format(amount)
    }

    return (
        <div className="flex w-full max-w-full min-w-0 flex-col gap-3 pb-2 mt-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Søk i tilbud..."
                    className="sm:max-w-sm"
                />

                <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                        <SelectValue placeholder="Sorter etter" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectLabel>Sorter etter</SelectLabel>
                            <SelectItem value="newest">Nyeste først</SelectItem>
                            <SelectItem value="oldest">Eldste først</SelectItem>
                            <SelectItem value="amount_desc">Beløp høy til lav</SelectItem>
                            <SelectItem value="amount_asc">Beløp lav til høy</SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>

            <div className="w-full min-w-0 max-w-full">
                <DataTable columns={columns} data={visibleData} />
            </div>
        </div>
    )
}