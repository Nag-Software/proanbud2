"use client"

import { CheckCircle, FileText, Send, Wallet } from "lucide-react"

import { columns, type Quota } from "@/components/tilbud/columns"
import { DataTable } from "@/components/tilbud/data-table"
import { NewOfferDrawer } from "@/components/tilbud/new-offer-drawer"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { type OfferCustomerOption, type OfferProjectOption } from "@/lib/tilbud/types"

type TilbudPageClientProps = {
  data: Quota[]
  projects: OfferProjectOption[]
  customers: OfferCustomerOption[]
  initialOpenNyttTilbud?: boolean
}

export function TilbudPageClient({
  data,
  projects,
  customers,
  initialOpenNyttTilbud = false,
}: TilbudPageClientProps) {
  const totalOffers = data.length
  const sentOffers = data.filter((d) => d.status === "sent")
  const sentCount = sentOffers.length

  const approvedOffers = data.filter((d) => d.status === "accepted")
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
    <div className="flex w-full max-w-full min-w-0 flex-col gap-6 pb-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Dine tilbud</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tilbudsoversikt</h1>
        </div>
        <div className="flex w-full items-center sm:w-auto">
          <NewOfferDrawer
            projects={projects}
            customers={customers}
            defaultOpen={initialOpenNyttTilbud}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Totalt antall</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalOffers}</div>
            <p className="mt-1 text-xs text-muted-foreground">Alle registrerte tilbud</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avventer Svar</CardTitle>
            <Send className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sentCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">Tilbud under vurdering</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Godkjent</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{approvedCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">Tilbud som er akseptert</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Godkjent Verdi</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNOK(approvedValue)}</div>
            <p className="mt-1 text-xs text-muted-foreground">Total sum av godkjente tilbud</p>
          </CardContent>
        </Card>
      </div>

      <div className="w-full min-w-0 max-w-full">
        <DataTable columns={columns} data={data} />
      </div>
    </div>
  )
}
