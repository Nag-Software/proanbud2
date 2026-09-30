"use client"

/**
 * Kostnadene som er ført på prosjektet i regnskapet (Tripletex/Fiken).
 *
 * Kortet finnes fordi dekningsgraden i ProAnbud ellers bare er så god som det
 * håndverkeren husker å taste inn. Når regnskapet har kostnader på prosjektet,
 * er det de som teller — og kortet sier tydelig hva som er med og hva som ikke er.
 */

import * as React from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { InfoHint } from "@/components/ui/info-hint"
import { actionErrorMessage, reportClientError } from "@/lib/errors/client"
import type { ProjectAccountingCosts } from "@/lib/job-costing/types"
import { formatNok } from "@/lib/tilbud/types"

import { getAccountingProviderAction, type AccountingProvider } from "./fakturering-actions"
import { pullAccountingCostsAction } from "./job-costing-actions"

const PROVIDER_LABELS: Record<string, string> = { fiken: "Fiken", tripletex: "Tripletex" }
/** Flere enn dette skjules bak «Vis alle», så kortet ikke blir en hovedbok. */
const COLLAPSED_COUNT = 6

function formatPulledAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString("nb-NO", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatCostDate(value: string | null) {
  if (!value) return null
  const date = new Date(`${value}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short", year: "numeric" })
}

export function AccountingCostsCard({
  projectId,
  canManage,
  accounting,
  onRefreshed,
}: {
  projectId: string
  canManage: boolean
  accounting: ProjectAccountingCosts | null
  onRefreshed: () => void
}) {
  const [provider, setProvider] = React.useState<AccountingProvider>(accounting?.provider ?? null)
  const [pulling, setPulling] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    getAccountingProviderAction(projectId)
      .then((value) => {
        if (!cancelled) setProvider(value)
      })
      .catch(() => {
        // Uten svar viser vi det vi vet fra forrige henting — ingen feilmelding
        // for noe brukeren ikke har bedt om.
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Ingen regnskapsintegrasjon og aldri hentet: kortet har ingenting å si.
  if (!provider && !accounting) return null

  const system = PROVIDER_LABELS[provider ?? accounting?.provider ?? ""] ?? "regnskapet"
  const costs = accounting?.costs ?? []
  const visible = expanded ? costs : costs.slice(0, COLLAPSED_COUNT)
  const pulledAt = accounting ? formatPulledAt(accounting.pulledAt) : null

  async function handlePull() {
    setPulling(true)
    try {
      await pullAccountingCostsAction(projectId)
      onRefreshed()
      toast.success(`Kostnadene er hentet fra ${system}`)
    } catch (error) {
      reportClientError(error, { context: { action: "hente kostnader fra regnskapet", projectId } })
      toast.error(actionErrorMessage(error, `Kunne ikke hente fra ${system}`))
    } finally {
      setPulling(false)
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium">Kostnader fra {system}</p>
            <InfoHint title={`Kostnader fra ${system}`}>
              <p>
                Innkjøp, underentreprenører og andre kostnader som er bokført på prosjektet i {system},
                eks. mva. Hentes automatisk hver natt.
              </p>
              <p>
                <strong>Lønn hentes ikke</strong> — lønnskosten regnes her som førte timer × kostpris.
                Reiseregninger fra kjøreboka hentes heller ikke; de står allerede som kjøring.
              </p>
              <p>
                Når {system} har kostnader på prosjektet, er det de som teller. Materialkostnader du har
                lagt inn for hånd holdes da utenfor, så samme faktura ikke telles to ganger.
              </p>
            </InfoHint>
          </div>
          <p className="text-xs text-muted-foreground">
            {pulledAt ? `Sist hentet ${pulledAt}` : "Ikke hentet ennå"}
          </p>
        </div>
        {canManage && provider ? (
          <Button size="sm" variant="outline" className="h-8" onClick={handlePull} disabled={pulling}>
            {pulling ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            {pulling ? "Henter …" : "Hent på nytt"}
          </Button>
        ) : null}
      </div>

      {costs.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {accounting
            ? `Ingen kostnader er bokført på prosjektet i ${system} ennå. Materialkostnadene du legger inn her brukes i stedet.`
            : `Kostnadene hentes første gang i natt, eller trykk «Hent på nytt».`}
        </p>
      ) : (
        <>
          <ul className="divide-y">
            {visible.map((cost) => (
              <li key={cost.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {cost.supplier_name || cost.description || cost.account_name || "Kostnad"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[
                      cost.supplier_name && cost.description ? cost.description : null,
                      [cost.account_number, cost.account_name].filter(Boolean).join(" ") || null,
                      cost.voucher_ref ? `Bilag ${cost.voucher_ref}` : null,
                      formatCostDate(cost.cost_date),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {formatNok(Number(cost.amount_nok))}
                </span>
              </li>
            ))}
          </ul>
          {costs.length > COLLAPSED_COUNT ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full border-t px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Vis færre" : `Vis alle ${costs.length}`}
            </button>
          ) : null}
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm">
            <span className="font-medium">Sum</span>
            <span className="font-semibold tabular-nums">{formatNok(accounting?.totalNok ?? 0)}</span>
          </div>
        </>
      )}
    </div>
  )
}
