"use client"

import { useEffect, useMemo, useState } from "react"
import { track } from "@/lib/analytics/track"
import { MVA_RATE } from "@/lib/verktoy/tools"
import { kr, kr2, num, pct } from "@/lib/verktoy/format"
import { NumField, ResultHero, StatRow } from "../calc-ui"

export function TimeprisCalculator() {
  const [arslonn, setArslonn] = useState(600_000)
  const [sosialePct, setSosialePct] = useState(35)
  const [faste, setFaste] = useState(150_000)
  const [timerPerUke, setTimerPerUke] = useState(30)
  const [ukerPerAar, setUkerPerAar] = useState(46)
  const [fortjenestePct, setFortjenestePct] = useState(10)
  const [naavaerende, setNaavaerende] = useState(0)

  useEffect(() => {
    track("verktoy_apnet", { verktoy: "timepris-kalkulator" })
  }, [])

  const r = useMemo(() => {
    const lonnskostnad = arslonn * (1 + sosialePct / 100)
    const totalKostnad = lonnskostnad + faste
    const fakturerbareTimer = timerPerUke * ukerPerAar
    const selvkost = fakturerbareTimer > 0 ? totalKostnad / fakturerbareTimer : NaN
    const fortj = Math.min(fortjenestePct, 95)
    const eksMva = selvkost / (1 - fortj / 100)
    const inklMva = eksMva * (1 + MVA_RATE)
    const aarligDiff = naavaerende > 0 ? (eksMva - naavaerende) * fakturerbareTimer : null
    return { lonnskostnad, totalKostnad, fakturerbareTimer, selvkost, eksMva, inklMva, aarligDiff }
  }, [arslonn, sosialePct, faste, timerPerUke, ukerPerAar, fortjenestePct, naavaerende])

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {/* Inndata */}
      <div className="rounded-2xl border bg-background p-5 shadow-sm">
        <div className="space-y-4">
          <NumField
            label="Ønsket årslønn (før skatt)"
            value={arslonn}
            onChange={setArslonn}
            suffix="kr"
            hint="Det du vil sitte igjen med i lønn."
          />
          <NumField
            label="Sosiale kostnader"
            value={sosialePct}
            onChange={setSosialePct}
            suffix="%"
            max={200}
            hint="Feriepenger, pensjon, arbeidsgiveravgift, forsikring."
          />
          <NumField
            label="Faste kostnader per år"
            value={faste}
            onChange={setFaste}
            suffix="kr"
            hint="Bil, verktøy, forsikring, regnskap, telefon, kontor."
          />
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Fakturerbare timer / uke" value={timerPerUke} onChange={setTimerPerUke} suffix="t" max={80} />
            <NumField label="Uker med jobb / år" value={ukerPerAar} onChange={setUkerPerAar} suffix="uker" max={52} />
          </div>
          <NumField
            label="Ønsket fortjeneste"
            value={fortjenestePct}
            onChange={setFortjenestePct}
            suffix="%"
            max={95}
            hint="Overskudd på toppen — buffer for dårlige tider og vekst."
          />
        </div>
      </div>

      {/* Resultat */}
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border bg-background p-5 shadow-sm">
          <ResultHero
            value={kr2(r.eksMva)}
            caption="Anbefalt timepris (eks. mva)"
            sub={`${kr2(r.inklMva)} inkl. mva`}
          />
          <div className="mt-4 border-t pt-2">
            <StatRow label="Selvkost per time" value={kr2(r.selvkost)} />
            <StatRow label="Fakturerbare timer per år" value={`${num(r.fakturerbareTimer)} t`} muted />
            <StatRow label="Lønn + sosiale kostnader" value={kr(r.lonnskostnad)} muted />
            <StatRow label="Faste kostnader" value={kr(faste)} muted />
            <StatRow label={`Fortjeneste (${pct(fortjenestePct, 0)})`} value={kr(r.eksMva * r.fakturerbareTimer - r.totalKostnad)} muted />
          </div>
        </div>

        {/* Wow: sammenlign med dagens pris */}
        <div className="rounded-2xl border bg-background p-5 shadow-sm">
          <NumField
            label="Hva tar du i timen i dag? (valgfritt)"
            value={naavaerende}
            onChange={setNaavaerende}
            suffix="kr"
            hint="Fyll inn for å se hva prisen din betyr på et helt år."
          />
          {naavaerende > 0 && Number.isFinite(r.aarligDiff ?? NaN) && (
            <div
              className={
                (r.aarligDiff ?? 0) > 0
                  ? "mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  : "mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
              }
            >
              {(r.aarligDiff ?? 0) > 0 ? (
                <>
                  Du ligger <strong>{kr2(r.eksMva - naavaerende)}</strong> under anbefalt pris. Med{" "}
                  {num(r.fakturerbareTimer)} timer i året er det ca{" "}
                  <strong>{kr(r.aarligDiff ?? 0)}</strong> i tapt fortjeneste.
                </>
              ) : (
                <>
                  Du ligger <strong>{kr2(naavaerende - r.eksMva)}</strong> over anbefalt minstepris — bra! Du har god
                  margin å gå på.
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
