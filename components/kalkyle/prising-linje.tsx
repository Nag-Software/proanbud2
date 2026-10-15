"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { formatKr } from "@/lib/kalkyle/format"
import { TallStepper } from "./tall-stepper"
import { useKalkyle } from "./kalkyle-provider"

/** Prisingen på én linje. De fleste endrer den aldri, så stepperne ligger bak «Endre». */
export function PrisingLinje() {
  const { kalkyle, oppdaterPrising } = useKalkyle()
  const [apen, setApen] = React.useState(false)
  const panelId = React.useId()
  if (!kalkyle) return null

  return (
    <div className="rounded-lg border bg-card px-3 py-1.5 shadow-[var(--shadow-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground tabular-nums">
          Timepris <span className="font-medium text-foreground">{formatKr(kalkyle.timesats)}</span> · påslag{" "}
          <span className="font-medium text-foreground">{kalkyle.paslagMateriell} %</span> på materiell og{" "}
          <span className="font-medium text-foreground">{kalkyle.paslagUe} %</span> på underentreprenør
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="underline underline-offset-4"
          aria-expanded={apen}
          aria-controls={panelId}
          onClick={() => setApen((v) => !v)}
        >
          {apen ? "Ferdig" : "Endre"}
        </Button>
      </div>
      {apen && (
        <div id={panelId} className="mt-2 border-t pt-1">
          <StepperRad label="Timepris">
            <TallStepper
              label="Timepris"
              verdi={kalkyle.timesats}
              steg={25}
              visning={`${formatKr(kalkyle.timesats)}/t`}
              onChange={(v) => oppdaterPrising("timesats", v)}
            />
          </StepperRad>
          <StepperRad label="Påslag materiell">
            <TallStepper
              label="Påslag materiell"
              verdi={kalkyle.paslagMateriell}
              steg={1}
              max={200}
              visning={`${kalkyle.paslagMateriell} %`}
              onChange={(v) => oppdaterPrising("paslagMateriell", v)}
            />
          </StepperRad>
          <StepperRad label="Påslag underentreprenør">
            <TallStepper
              label="Påslag underentreprenør"
              verdi={kalkyle.paslagUe}
              steg={1}
              max={200}
              visning={`${kalkyle.paslagUe} %`}
              onChange={(v) => oppdaterPrising("paslagUe", v)}
            />
          </StepperRad>
          <p className="pb-1 pt-2 text-[13px] text-muted-foreground">
            Intern kost {formatKr(kalkyle.internKostPerTime)}/t. Standardverdiene kommer fra Timepriser, og endringer her
            gjelder bare denne kalkylen.
          </p>
        </div>
      )}
    </div>
  )
}

function StepperRad({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  )
}
