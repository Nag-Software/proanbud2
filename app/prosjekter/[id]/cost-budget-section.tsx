"use client"

/**
 * «Kostnader og budsjett» på Økonomi: tre poster — Lønn, Materialer, Kjøring —
 * med forbruk mot budsjett, og materiallisten under.
 *
 * Budsjettet redigeres i posten det gjelder, ikke i et eget skjema: det er der man
 * ser hvor mye som er brukt. Timebudsjettet står som standard på timene i
 * aksepterte tilbud + godkjent tilleggsarbeid; et tall satt her overstyrer det.
 */

import * as React from "react"
import { useState } from "react"
import Link from "next/link"
import { Pencil } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { InfoHint } from "@/components/ui/info-hint"
import { Input } from "@/components/ui/input"
import { actionErrorMessage, reportClientError } from "@/lib/errors/client"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import { formatNok } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"

import { saveProjectBudgetAction } from "./job-costing-actions"
import { MaterialCostsCard } from "./material-costs-card"

/** «86 t», «12,5 t» — ikke «86.00 t». */
function formatHours(value: number) {
  return `${Number(value || 0).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} t`
}

/** Forbruk i prosent av budsjettet. `null` uten budsjett. */
function usedPct(used: number, budget: number | null) {
  if (budget === null || budget <= 0) return null
  return Math.round((used / budget) * 100)
}

/** Svart under 90 %, ravgul mot slutten, rød over budsjett. */
function toneFor(pct: number | null) {
  if (pct === null) return { bar: "bg-foreground", text: "text-muted-foreground" }
  if (pct > 100) return { bar: "bg-destructive", text: "text-destructive" }
  if (pct >= 90) return { bar: "bg-amber-600", text: "text-amber-700 dark:text-amber-400" }
  return { bar: "bg-foreground", text: "text-muted-foreground" }
}

function parseNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN
}

function ProgressBar({ pct }: { pct: number | null }) {
  const tone = toneFor(pct)
  return (
    <div
      className="h-1.5 overflow-hidden rounded-full bg-muted"
      role={pct === null ? undefined : "progressbar"}
      aria-valuenow={pct ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {pct !== null ? (
        <span className={cn("block h-full", tone.bar)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      ) : null}
    </div>
  )
}

/**
 * Redigering av ett budsjettall rett i posten. Tomt felt = tilbake til standard
 * (fra tilbudet), ikke 0 — «ikke satt» og «null budsjettert» er to ting.
 */
function BudgetEditor({
  label,
  unit,
  initial,
  defaultValue,
  defaultLabel,
  onSave,
  onCancel,
}: {
  label: string
  unit: string
  initial: number | null
  defaultValue: number | null
  defaultLabel: string
  onSave: (value: number | null) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial?.toString() ?? "")
  const [saving, setSaving] = useState(false)
  const inputId = React.useId()

  async function save(next: number | null) {
    setSaving(true)
    try {
      await onSave(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = parseNumber(value)
        if (Number.isNaN(parsed)) {
          toast.error("Skriv inn et tall, eller la feltet stå tomt")
          return
        }
        void save(parsed)
      }}
    >
      <label htmlFor={inputId} className="text-xs text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <Input
          id={inputId}
          autoFocus
          inputMode="decimal"
          value={value}
          placeholder={defaultValue !== null ? String(defaultValue) : "Ikke satt"}
          onChange={(event) => setValue(event.target.value)}
          className="pr-10 tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {unit}
        </span>
      </div>
      {defaultValue !== null ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(null)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Bruk {defaultLabel}
        </button>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Avbryt
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Lagrer …" : "Lagre"}
        </Button>
      </div>
    </form>
  )
}

function PostTile({
  label,
  info,
  editing,
  onEdit,
  children,
}: {
  label: string
  info?: React.ReactNode
  editing?: boolean
  onEdit?: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4",
        editing && "border-foreground/60"
      )}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <div className="flex items-center gap-0.5">
          <span className="text-sm text-muted-foreground">{label}</span>
          {info ? <InfoHint title={label}>{info}</InfoHint> : null}
        </div>
        {onEdit && !editing ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground"
            onClick={onEdit}
            aria-label={`Endre budsjett for ${label.toLowerCase()}`}
          >
            <Pencil className="size-3.5" />
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  )
}

export function CostBudgetSection({
  projectId,
  canManage,
  data,
  heading,
  onChanged,
}: {
  projectId: string
  canManage: boolean
  data: ProjectProfitability
  heading?: React.ReactNode
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<"hours" | "material" | null>(null)
  const { actual, budget } = data

  async function saveBudget(next: { hours?: number | null; materialNok?: number | null }) {
    try {
      await saveProjectBudgetAction({
        projectId,
        budgetedHours: "hours" in next ? (next.hours ?? null) : data.budgetInput.hours,
        budgetedMaterialNok: "materialNok" in next ? (next.materialNok ?? null) : data.budgetInput.materialNok,
      })
      toast.success("Budsjettet er lagret")
      setEditing(null)
      onChanged()
    } catch (error) {
      reportClientError(error, { context: { action: "lagre prosjektbudsjett", projectId } })
      toast.error(actionErrorMessage(error, "Kunne ikke lagre"))
    }
  }

  const hoursPct = usedPct(data.hours.logged, budget.hours)
  const hoursLeft = budget.hours === null ? null : Math.round((budget.hours - data.hours.logged) * 10) / 10
  const materialPct = usedPct(actual.materialCostNok, budget.materialNok)
  const materialLeft = budget.materialNok === null ? null : Math.round(budget.materialNok - actual.materialCostNok)
  const plannedTotal = data.planned?.totalCostNok ?? null

  const bookedCount = data.materialCosts.filter((cost) => cost.source !== "manual").length
  const manualCount = data.materialCosts.filter((cost) => cost.source === "manual" && !cost.replaced_by).length

  // Si nøyaktig hvor standardtimene kommer fra — «fra tilbudene» er feil når alt
  // står på tilleggsarbeid (timebasert tillegg med anslåtte timer).
  const defaultHoursOrigin =
    budget.offerHours > 0 && budget.changeOrderHours > 0
      ? `tilbud ${formatHours(budget.offerHours)} + tillegg ${formatHours(budget.changeOrderHours)}`
      : budget.changeOrderHours > 0
        ? "godkjent tilleggsarbeid"
        : "tilbudene"
  const hoursSourceText =
    budget.hoursSource === "manuell"
      ? "Satt på prosjektet"
      : budget.hoursSource === "tilbud"
        ? `Fra ${defaultHoursOrigin}`
        : null

  return (
    // Container-query, ikke skjermbredde: Økonomi har sidemeny og seksjonsindeks,
    // så innholdet er smalt lenge etter at skjermen er «desktop».
    <div className="@container space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        {heading}
        <p className="text-sm text-muted-foreground">
          Sum kostnad{" "}
          <span className="font-semibold tabular-nums text-foreground">{formatNok(actual.totalCostNok)}</span>
          {plannedTotal && plannedTotal > 0 ? <> av {formatNok(plannedTotal)}</> : null}
        </p>
      </div>

      <div className="grid gap-3 @2xl:grid-cols-3">
        {/* Lønn */}
        <PostTile
          label="Lønn"
          editing={editing === "hours"}
          onEdit={canManage ? () => setEditing("hours") : undefined}
          info={
            <>
              <p>Førte timer × kostpris. Avviste timer er ikke med.</p>
              <p>
                {data.costRateNok > 0
                  ? `Kostprisen er ${formatNok(data.costRateNok)}/t — snittet av kostprisene på timeprisene dine.`
                  : "Ingen av timeprisene dine har kostpris ennå, så lønnskosten blir 0 kr."}
              </p>
              <p>
                Timebudsjettet er som standard timene i de aksepterte tilbudene pluss anslåtte timer på godkjent
                tilleggsarbeid. Setter du et eget tall, gjelder det i stedet.
              </p>
            </>
          }
        >
          <p className="text-2xl font-semibold tabular-nums">{formatNok(actual.laborCostNok)}</p>
          <ProgressBar pct={hoursPct} />
          {editing === "hours" ? (
            <BudgetEditor
              label="Budsjetterte timer"
              unit="t"
              initial={data.budgetInput.hours}
              defaultValue={budget.defaultHours}
              defaultLabel={
                budget.offerHours > 0 && budget.changeOrderHours > 0
                  ? `timene fra tilbud og tillegg (${formatHours(budget.defaultHours ?? 0)}: ${defaultHoursOrigin})`
                  : `timene fra ${defaultHoursOrigin} (${formatHours(budget.defaultHours ?? 0)})`
              }
              onSave={(value) => saveBudget({ hours: value })}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-sm">
              <span className="text-muted-foreground">
                {budget.hours !== null
                  ? `${formatHours(data.hours.logged)} av ${formatHours(budget.hours)}`
                  : `${formatHours(data.hours.logged)} ført`}
              </span>
              {hoursLeft !== null ? (
                <span className={cn("font-medium tabular-nums", toneFor(hoursPct).text)}>
                  {hoursLeft >= 0 ? `${formatHours(hoursLeft)} igjen` : `${formatHours(-hoursLeft)} over`}
                </span>
              ) : (
                <span className="text-muted-foreground">Ikke budsjettert</span>
              )}
            </div>
          )}
          {hoursSourceText && editing !== "hours" ? (
            <p className="-mt-1.5 text-xs text-muted-foreground">{hoursSourceText}</p>
          ) : null}
          {data.laborByUser.length > 0 ? (
            <ul className="space-y-1.5 border-t pt-3 text-sm">
              {data.laborByUser.map((entry) => (
                <li key={entry.userId} className="flex justify-between gap-3">
                  <span className="truncate">{entry.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatHours(entry.hours)} · {formatNok(entry.costNok)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t pt-3 text-sm text-muted-foreground">Ingen timer ført ennå.</p>
          )}
        </PostTile>

        {/* Materialer */}
        <PostTile
          label="Materialer"
          editing={editing === "material"}
          onEdit={canManage ? () => setEditing("material") : undefined}
          info={
            <>
              <p>Alt i materiallisten under, eks. mva: bokført i regnskapet pluss innkjøp lagt inn her som ikke er bokført ennå.</p>
              <p>
                Materialbudsjettet er som standard tilbudets kalkulerte materialkost (innkjøpspris før påslag), når
                tilbudet har det. Bruk innkjøpsprisen — det du betaler leverandøren.
              </p>
            </>
          }
        >
          <p className="text-2xl font-semibold tabular-nums">{formatNok(actual.materialCostNok)}</p>
          <ProgressBar pct={materialPct} />
          {editing === "material" ? (
            <BudgetEditor
              label="Budsjettert materialkost (eks. mva)"
              unit="kr"
              initial={data.budgetInput.materialNok}
              defaultValue={budget.defaultMaterialNok === null ? null : Math.round(budget.defaultMaterialNok)}
              defaultLabel={`kalkylen fra tilbudet (${formatNok(budget.defaultMaterialNok ?? 0)})`}
              onSave={(value) => saveBudget({ materialNok: value })}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-sm">
              <span className="text-muted-foreground">
                {budget.materialNok !== null ? `av ${formatNok(budget.materialNok)}` : "Ikke budsjettert"}
              </span>
              {materialLeft !== null ? (
                <span className={cn("font-medium tabular-nums", toneFor(materialPct).text)}>
                  {materialLeft >= 0 ? `${formatNok(materialLeft)} igjen` : `${formatNok(-materialLeft)} over`}
                </span>
              ) : null}
            </div>
          )}
          <p className="border-t pt-3 text-sm text-muted-foreground">
            {data.costSync
              ? `${bookedCount} bokført i regnskapet · ${manualCount} ikke bokført`
              : `${manualCount} ${manualCount === 1 ? "post" : "poster"} lagt inn`}
          </p>
        </PostTile>

        {/* Kjøring */}
        <PostTile
          label="Kjøring"
          info={<p>Kjøregodtgjørelse etter statens satser fra kjøreboka. Private turer er ikke med.</p>}
        >
          <p className="text-2xl font-semibold tabular-nums">{formatNok(actual.drivingCostNok)}</p>
          <ProgressBar pct={null} />
          <p className="text-sm text-muted-foreground">Ikke budsjettert</p>
          <p className="border-t pt-3 text-sm">
            <Link href="/kjorebok" className="underline underline-offset-2">
              Åpne kjøreboka
            </Link>
          </p>
        </PostTile>
      </div>

      <MaterialCostsCard
        projectId={projectId}
        canManage={canManage}
        costs={data.materialCosts}
        summary={data.materialSummary}
        costSync={data.costSync}
        onChanged={onChanged}
      />
    </div>
  )
}
