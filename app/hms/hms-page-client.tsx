"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { updateCompanyHmsAction } from "@/app/hms/actions"
import { PageHeader } from "@/components/page-header"
import { DeviationListItem, DeviationStatsCards } from "@/components/hms/deviation-badges"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type { DeviationStats, DeviationWithRelations } from "@/lib/hms/types"

type Props = {
  isAdmin: boolean
  stats: DeviationStats
  openDeviations: DeviationWithRelations[]
  handbookContent: string
}

export function HmsPageClient({ isAdmin, stats, openDeviations, handbookContent }: Props) {
  const [content, setContent] = React.useState(handbookContent)
  const [busy, setBusy] = React.useState(false)

  async function handleSaveHandbook() {
    setBusy(true)
    try {
      await updateCompanyHmsAction({ handbookContent: content })
      toast.success("HMS-håndbok lagret")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="HMS"
        subtitle="Oversikt og enkel HMS-håndbok for bedriften"
      />

      <DeviationStatsCards stats={stats} />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Åpne avvik</h2>
          <Button variant="link" size="sm" asChild>
            <Link href="/avvik">Se alle →</Link>
          </Button>
        </div>
        {openDeviations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ingen åpne avvik</p>
        ) : (
          <div className="space-y-2">
            {openDeviations.map((d) => (
              <DeviationListItem key={d.id} deviation={d} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="font-medium">HMS-håndbok</h2>
        <p className="text-sm text-muted-foreground">
          Enkel oversikt over rutiner og HMS-info for bedriften.
        </p>
        {isAdmin ? (
          <>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder="Skriv inn HMS-rutiner, kontaktpersoner, viktige regler..."
            />
            <Button onClick={handleSaveHandbook} disabled={busy}>
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Lagre håndbok
            </Button>
          </>
        ) : (
          <div className="text-sm whitespace-pre-wrap text-muted-foreground">
            {content || "Ingen HMS-håndbok er lagt inn ennå."}
          </div>
        )}
      </div>
    </div>
  )
}
