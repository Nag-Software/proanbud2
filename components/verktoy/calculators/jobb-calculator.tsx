"use client"

import { useEffect, useMemo, useState } from "react"
import { track } from "@/lib/analytics/track"
import { MVA_RATE } from "@/lib/verktoy/tools"
import { kr, pct } from "@/lib/verktoy/format"
import { NumField, ResultHero, StatRow } from "../calc-ui"

export function JobbCalculator() {
  const [timer, setTimer] = useState(20)
  const [timepris, setTimepris] = useState(850)
  const [materialKost, setMaterialKost] = useState(5000)
  const [materialPaaslag, setMaterialPaaslag] = useState(25)
  const [km, setKm] = useState(0)
  const [kmSats, setKmSats] = useState(5)
  const [bufferPct, setBufferPct] = useState(5)

  useEffect(() => {
    track("verktoy_apnet", { verktoy: "jobbkalkulator" })
  }, [])

  const r = useMemo(() => {
    const arbeid = timer * timepris
    const materialUtsalg = materialKost * (1 + materialPaaslag / 100)
    const materialFortjeneste = materialUtsalg - materialKost
    const kjoring = km * kmSats
    const subtotal = arbeid + materialUtsalg + kjoring
    const buffer = subtotal * (bufferPct / 100)
    const eksMva = subtotal + buffer
    const mva = eksMva * MVA_RATE
    const inkl = eksMva + mva
    return { arbeid, materialUtsalg, materialFortjeneste, kjoring, buffer, eksMva, mva, inkl }
  }, [timer, timepris, materialKost, materialPaaslag, km, kmSats, bufferPct])

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {/* Inndata */}
      <div className="rounded-2xl border bg-background p-5 shadow-sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Arbeidstimer" value={timer} onChange={setTimer} suffix="t" />
            <NumField label="Timepris (eks. mva)" value={timepris} onChange={setTimepris} suffix="kr" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Materiell (innkjøp)" value={materialKost} onChange={setMaterialKost} suffix="kr" />
            <NumField label="Påslag materiell" value={materialPaaslag} onChange={setMaterialPaaslag} suffix="%" max={1000} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumField label="Kjøring" value={km} onChange={setKm} suffix="km" />
            <NumField label="Sats per km" value={kmSats} onChange={setKmSats} suffix="kr" />
          </div>
          <NumField
            label="Buffer for det uforutsette"
            value={bufferPct}
            onChange={setBufferPct}
            suffix="%"
            max={100}
            hint="Påslag på hele jobben for uventet arbeid og svinn."
          />
        </div>
      </div>

      {/* Resultat */}
      <div className="rounded-2xl border bg-background p-5 shadow-sm">
        <ResultHero value={kr(r.inkl)} caption="Pris til kunde (inkl. mva)" sub={`${kr(r.eksMva)} eks. mva`} />
        <div className="mt-4 border-t pt-2">
          <StatRow label={`Arbeid (${timer} t × ${kr(timepris)})`} value={kr(r.arbeid)} muted />
          <StatRow label={`Materiell (+${pct(materialPaaslag, 0)} påslag)`} value={kr(r.materialUtsalg)} muted />
          {r.kjoring > 0 && <StatRow label="Kjøring" value={kr(r.kjoring)} muted />}
          {r.buffer > 0 && <StatRow label={`Buffer (${pct(bufferPct, 0)})`} value={kr(r.buffer)} muted />}
          <StatRow label="Sum eks. mva" value={kr(r.eksMva)} strong />
          <StatRow label="MVA (25 %)" value={kr(r.mva)} muted />
          <StatRow label="Total inkl. mva" value={kr(r.inkl)} strong />
        </div>
        {r.materialFortjeneste > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Herav fortjeneste på materiell: <span className="tabular-nums">{kr(r.materialFortjeneste)}</span>
          </p>
        )}
      </div>
    </div>
  )
}
