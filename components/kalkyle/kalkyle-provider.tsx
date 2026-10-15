"use client"

import * as React from "react"

import { beregnKalkyle } from "@/lib/kalkyle/beregn"
import { brukEndringer, type KalkyleEndring } from "@/lib/kalkyle/endringer"
import type { Kalkyle, KalkyleResultat, Linje, LinjeType, Prising } from "@/lib/kalkyle/types"

type KalkyleContextValue = {
  /** Null før en kalkyle er laget (da vises startskjermen). */
  kalkyle: Kalkyle | null
  resultat: KalkyleResultat | null
  settKalkyle: (kalkyle: Kalkyle | null) => void
  /** Bruker endringer (samme vei som chatten) og returnerer id-ene som ble berørt. */
  endre: (endringer: KalkyleEndring[]) => string[]
  oppdaterPrising: (felt: keyof Prising, verdi: number) => void
  oppdaterLinje: (postId: string, linjeId: string, patch: Partial<Omit<Linje, "id">>) => void
  leggTilLinje: (postId: string, type: LinjeType) => string | null
  fjernLinje: (postId: string, linjeId: string) => void
  leggTilPost: (navn: string) => string | null
  oppdaterPost: (postId: string, navn: string) => void
  fjernPost: (postId: string) => void
  /** Linjer lagt inn fra chatten, merket «Ny» til siden lastes på nytt. */
  merket: ReadonlySet<string>
  merk: (ider: string[]) => void
}

const KalkyleContext = React.createContext<KalkyleContextValue | null>(null)

const STANDARD_ENHET: Record<LinjeType, Linje["enhet"]> = { arbeid: "t", materiell: "stk", ue: "rs", jobb: "stk" }

/**
 * Holder kalkylen i minnet mens den redigeres (mock-runden: ingen lagring).
 * Alt går gjennom brukEndringer, så skjema, ark og chat endrer kalkylen likt.
 */
export function KalkyleProvider({ initial, children }: { initial: Kalkyle | null; children: React.ReactNode }) {
  const [kalkyle, setKalkyle] = React.useState<Kalkyle | null>(initial)
  const [merket, setMerket] = React.useState<ReadonlySet<string>>(() => new Set())
  // Siste verdi uten å vente på ny render, så to endringer i samme klikk ikke
  // overskriver hverandre. Oppdateres bare via `sett`.
  const ref = React.useRef(kalkyle)

  const sett = React.useCallback((neste: Kalkyle | null) => {
    ref.current = neste
    setKalkyle(neste)
  }, [])

  const endre = React.useCallback(
    (endringer: KalkyleEndring[]) => {
      if (!ref.current) return []
      const r = brukEndringer(ref.current, endringer)
      sett(r.kalkyle)
      return r.berort
    },
    [sett]
  )

  const value = React.useMemo<KalkyleContextValue>(() => {
    const finnPost = (postId: string) => ref.current?.poster.find((p) => p.id === postId)
    return {
      kalkyle,
      resultat: kalkyle ? beregnKalkyle(kalkyle) : null,
      settKalkyle: (k) => {
        sett(k)
        setMerket(new Set())
      },
      endre,
      oppdaterPrising: (felt, verdi) => endre([{ type: "prising", felt, verdi }]),
      oppdaterLinje: (postId, linjeId, patch) => endre([{ type: "endre", postId, linjeId, patch }]),
      leggTilLinje: (postId, type) =>
        endre([
          {
            type: "leggTil",
            postId,
            linje: { beskrivelse: "", type, antall: 1, enhet: STANDARD_ENHET[type], innpris: type === "arbeid" ? null : 0 },
          },
        ])[0] ?? null,
      fjernLinje: (postId, linjeId) => endre([{ type: "fjern", postId, linjeId }]),
      leggTilPost: (navn) => {
        const for_ = new Set(ref.current?.poster.map((p) => p.id))
        endre([{ type: "nyPost", navn }])
        return ref.current?.poster.find((p) => !for_.has(p.id))?.id ?? null
      },
      oppdaterPost: (postId, navn) => {
        if (!ref.current || !finnPost(postId)) return
        sett({ ...ref.current, poster: ref.current.poster.map((p) => (p.id === postId ? { ...p, navn } : p)) })
      },
      fjernPost: (postId) => {
        if (!ref.current) return
        sett({ ...ref.current, poster: ref.current.poster.filter((p) => p.id !== postId) })
      },
      merket,
      merk: (ider) => setMerket((prev) => new Set([...prev, ...ider])),
    }
  }, [kalkyle, merket, endre, sett])

  return <KalkyleContext.Provider value={value}>{children}</KalkyleContext.Provider>
}

export function useKalkyle() {
  const value = React.useContext(KalkyleContext)
  if (!value) throw new Error("useKalkyle må brukes inne i <KalkyleProvider>")
  return value
}
