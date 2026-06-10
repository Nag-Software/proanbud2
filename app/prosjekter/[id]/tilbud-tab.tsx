"use client"

import { useMemo, useState } from "react"

import { OfferCard, type OfferCardData } from "@/components/tilbud/offer-card"
import { type Quota } from "@/components/tilbud/columns"
import { readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

type OfferRow = {
    id: string
    title?: string | null
    description?: string | null
    amount_nok?: number | null
    status?: string | null
    created_at?: string | null
    analysis_result?: unknown
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

export default function TilbudTab({ offers }: TilbudTabProps) {
    const [search, setSearch] = useState("")
    const [sortBy, setSortBy] = useState<SortOption>("newest")

    const cardData = useMemo(() => {
        return offers.map((item) => {
            const createdRaw = item.created_at || ""
            const amount = Number(item.amount_nok || 0)
            const aiDescription = readProjectSummaryFromAnalysis(item.analysis_result)

            return {
                id: item.id,
                title: item.title?.trim() || item.description?.trim() || "Uten navn",
                description: aiDescription || "Ingen KI-beskrivelse",
                created: formatDisplayDate(item.created_at),
                createdRaw,
                amount,
                status: normalizeStatus(item.status),
            }
        })
    }, [offers])

    const visibleData = useMemo((): OfferCardData[] => {
        const needle = search.trim().toLowerCase()

        let filtered = cardData
        if (needle) {
            filtered = cardData.filter((item) => {
                const haystack = `${item.id} ${item.title} ${item.description} ${item.status}`.toLowerCase()
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

        return sorted.map(({ createdRaw: _createdRaw, ...offer }) => offer)
    }, [cardData, search, sortBy])

    return (
        <div className="mt-2 flex w-full max-w-full min-w-0 flex-col gap-3 pb-2">
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

            {visibleData.length > 0 ? (
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
                    {visibleData.map((offer) => (
                        <OfferCard key={offer.id} offer={offer} />
                    ))}
                </div>
            ) : (
                <div className="rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center">
                    <p className="text-sm text-muted-foreground">
                        {offers.length === 0 ? "Ingen tilbud på dette prosjektet ennå." : "Ingen tilbud matcher søket."}
                    </p>
                </div>
            )}
        </div>
    )
}
