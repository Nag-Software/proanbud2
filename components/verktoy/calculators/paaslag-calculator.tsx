"use client"

import { useEffect, useMemo, useState } from "react"
import { track } from "@/lib/analytics/track"
import { MVA_RATE } from "@/lib/verktoy/tools"
import { kr2, pct } from "@/lib/verktoy/format"
import { NumField, ResultHero, SegToggle, StatRow } from "../calc-ui"

type Mode = "paaslag" | "margin"

export function PaaslagCalculator() {
  const [innkjop, setInnkjop] = useState(1000)
  const [mode, setMode] = useState<Mode>("paaslag")
  const [paaslagInn, setPaaslagInn] = useState(40)
  const [marginInn, setMarginInn] = useState(30)

  useEffect(() => {
    track("verktoy_apnet", { verktoy: "paaslag-kalkulator" })
  }, [])

  const r = useMemo(() => {
    let paaslag: number
    let dekningsgrad: number
    let utsalgEks: number
    if (mode === "paaslag") {
      paaslag = paaslagInn
      utsalgEks = innkjop * (1 + paaslag / 100)
      dekningsgrad = utsalgEks > 0 ? ((utsalgEks - innkjop) / utsalgEks) * 100 : 0
    } else {
      dekningsgrad = Math.min(marginInn, 99)
      utsalgEks = innkjop / (1 - dekningsgrad / 100)
      paaslag = innkjop > 0 ? ((utsalgEks - innkjop) / innkjop) * 100 : 0
    }
    const db = utsalgEks - innkjop
    const utsalgInkl = utsalgEks * (1 + MVA_RATE)
    return { paaslag, dekningsgrad, utsalgEks, db, utsalgInkl }
  }, [innkjop, mode, paaslagInn, marginInn])

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {/* Inndata */}
      <div className="rounded-2xl border bg-background p-5 shadow-sm">
        <div className="space-y-4">
          <NumField label="Innkjøpspris (eks. mva)" value={innkjop} onChange={setInnkjop} suffix="kr" />

          <div className="space-y-2">
            <p className="text-sm font-medium">Hva vet du?</p>
            <SegToggle
              value={mode}
              onChange={setMode}
              options={[
                { value: "paaslag", label: "Påslaget" },
                { value: "margin", label: "Ønsket margin" },
              ]}
            />
          </div>

          {mode === "paaslag" ? (
            <NumField
              key="paaslag"
              label="Påslag på innkjøpspris"
              value={paaslagInn}
              onChange={setPaaslagInn}
              suffix="%"
              max={1000}
              hint="Legges oppå det du betalte for varen."
            />
          ) : (
            <NumField
              key="margin"
              label="Ønsket dekningsgrad (margin)"
              value={marginInn}
              onChange={setMarginInn}
              suffix="%"
              max={99}
              hint="Hvor stor andel av salgsprisen som skal være fortjeneste."
            />
          )}
        </div>
      </div>

      {/* Resultat */}
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border bg-background p-5 shadow-sm">
          <ResultHero
            value={kr2(r.utsalgEks)}
            caption="Utsalgspris (eks. mva)"
            sub={`${kr2(r.utsalgInkl)} inkl. mva`}
          />
          <div className="mt-4 border-t pt-2">
            <StatRow label="Innkjøpspris" value={kr2(innkjop)} muted />
            <StatRow label="Påslag" value={pct(r.paaslag)} />
            <StatRow label="Dekningsbidrag" value={kr2(r.db)} />
            <StatRow label="Dekningsgrad (margin)" value={pct(r.dekningsgrad)} strong />
          </div>
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
          <strong>{pct(r.paaslag)} påslag</strong> tilsvarer en dekningsgrad (margin) på{" "}
          <strong>{pct(r.dekningsgrad)}</strong>. Påslag regnes av innkjøpsprisen, margin av salgsprisen — derfor er de
          alltid forskjellige.
        </div>
      </div>
    </div>
  )
}
