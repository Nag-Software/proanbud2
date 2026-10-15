"use client"

import * as React from "react"
import { toast } from "sonner"

import { actionErrorMessage, reportClientError } from "@/lib/errors/client"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import type { ChangeOrder } from "@/lib/tilleggsarbeid/change-order"
import { formatNok } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"

import { EtterfaktureringTab } from "./etterfakturering-tab"
import { FaktureringPanel } from "./fakturering-panel"
import { getProjectProfitabilityAction } from "./job-costing-actions"
import { useProjectShell } from "./project-tabs-shell"
import { useSeksjonFokus } from "./seksjon-fokus"

/** Seksjonene. Verdiene er `?del=`, så gamle lenker til Økonomi lander riktig. */
const SEKSJONER = [
  { verdi: "status", navn: "Status" },
  { verdi: "fakturering", navn: "Fakturering" },
  { verdi: "tilleggsarbeid", navn: "Tilleggsarbeid" },
] as const

const seksjonId = (verdi: string) => `faktura-${verdi}`

type FakturaTabProps = {
  projectId: string
  canManage: boolean
  changeOrders: ChangeOrder[] | null
  customerEmail: string | null
  /** Samme lønnsomhet som Etterkalkyle; her brukes omsetning og fakturert. */
  profitability: ProjectProfitability | null
  counts: { changeOrders: number }
}

/**
 * Prosjekt → Faktura (bak KALKYLE_ENABLED). Pengene inn: hvor mye som er
 * fakturert og hva som gjenstår, fakturering av det som er klart og
 * tilleggsarbeid. Komponentene er de samme som på Økonomi, bare samlet her.
 */
export function FakturaTab({ projectId, canManage, changeOrders, customerEmail, profitability, counts }: FakturaTabProps) {
  const { setDel } = useProjectShell()
  // Ny ekstrajobb → fakturagrunnlaget hentes på nytt; ny faktura → nøkkeltallene.
  const [endretTillegg, setEndretTillegg] = React.useState(0)
  const [data, setData] = React.useState(profitability)
  const [sett, setSett] = React.useState(profitability)
  if (profitability !== sett) {
    setSett(profitability)
    if (profitability) setData(profitability)
  }
  useSeksjonFokus("faktura", seksjonId)

  const oppdaterTall = React.useCallback(() => {
    getProjectProfitabilityAction(projectId)
      .then(setData)
      .catch((e) => {
        reportClientError(e, { level: "warning", context: { action: "faktura_status", projectId } })
        toast.error(actionErrorMessage(e, "Kunne ikke oppdatere fakturastatusen"))
      })
  }, [projectId])

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[176px_minmax(0,1fr)]">
      <nav aria-label="Seksjoner i Faktura" className="sticky top-4 hidden lg:block">
        <ul className="flex flex-col">
          {SEKSJONER.map((s) => (
            <li key={s.verdi}>
              <a
                href={`#${seksjonId(s.verdi)}`}
                onClick={(ev) => {
                  ev.preventDefault()
                  setDel(s.verdi === "status" ? null : s.verdi)
                  document.getElementById(seksjonId(s.verdi))?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
                className="flex items-center justify-between border-l-2 border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {s.navn}
                {s.verdi === "tilleggsarbeid" && counts.changeOrders > 0 && (
                  <span className="text-xs tabular-nums">{counts.changeOrders}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-8">
        <section id={seksjonId("status")} aria-labelledby="faktura-tittel" className="scroll-mt-4 space-y-3">
          <div>
            <h2 id="faktura-tittel" className="text-base font-semibold">
              Faktura
            </h2>
            <p className="text-sm text-muted-foreground">Hva kunden skal betale, hva som er fakturert og hva som gjenstår. Eks. mva.</p>
          </div>
          <FakturaStatus data={data} />
        </section>

        <section id={seksjonId("fakturering")} className="scroll-mt-4">
          <FaktureringPanel projectId={projectId} canManage={canManage} refreshSignal={endretTillegg} onChanged={oppdaterTall} />
        </section>

        <section id={seksjonId("tilleggsarbeid")} className="scroll-mt-4">
          <EtterfaktureringTab
            projectId={projectId}
            canManage={canManage}
            initialItems={changeOrders}
            customerEmail={customerEmail}
            onChanged={() => {
              setEndretTillegg((n) => n + 1)
              oppdaterTall()
            }}
          />
        </section>
      </div>
    </div>
  )
}

/** Fire ruter: å fakturere, fakturert, betalt og gjenstår. */
export function FakturaStatus({ data }: { data: ProjectProfitability | null }) {
  if (!data) {
    return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Henter tallene …</p>
  }
  const aFakturere = data.revenueNok
  const fakturert = data.invoiced.totalNok
  const gjenstar = Math.max(0, aFakturere - fakturert)
  const fordeling = [
    data.revenue.offersNok > 0 ? `Tilbud ${formatNok(data.revenue.offersNok)}` : null,
    data.revenue.changeOrdersNok > 0 ? `tillegg ${formatNok(data.revenue.changeOrdersNok)}` : null,
    data.revenue.hourlyNok > 0 ? `timer ${formatNok(data.revenue.hourlyNok)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Rute navn="Å fakturere" verdi={formatNok(aFakturere)} under={fordeling || "Ingen aksepterte tilbud ennå"} />
      <Rute
        navn="Fakturert"
        verdi={formatNok(fakturert)}
        under={
          aFakturere > 0
            ? `${Math.round((fakturert / aFakturere) * 100)} % · ${data.invoiced.source === "regnskap" ? "fra regnskapet" : "i Proanbud"}`
            : undefined
        }
      />
      <Rute
        navn="Betalt"
        verdi={formatNok(data.invoiced.paidNok)}
        under={data.invoiced.source === "regnskap" ? "Betaling hentes bare for fakturaer laget i Proanbud" : undefined}
      />
      <Rute navn="Gjenstår" verdi={formatNok(gjenstar)} under={gjenstar === 0 && aFakturere > 0 ? "Alt er fakturert" : undefined} sterk={gjenstar > 0} />
    </div>
  )
}

function Rute({ navn, verdi, under, sterk }: { navn: string; verdi: string; under?: string; sterk?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", sterk && "border-foreground/30")}>
      <p className="text-xs text-muted-foreground">{navn}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{verdi}</p>
      {under && <p className="mt-0.5 text-xs text-muted-foreground">{under}</p>}
    </div>
  )
}
