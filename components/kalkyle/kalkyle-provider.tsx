"use client"

import * as React from "react"

import { beregnKalkyle } from "@/lib/kalkyle/beregn"
import { brukEndringer, type KalkyleEndring } from "@/lib/kalkyle/endringer"
import type {
  Detaljniva,
  Kalkyle,
  KalkyleResultat,
  Linje,
  LinjeType,
  Prising,
  TilbudSnapshot,
  TilbudStatus,
} from "@/lib/kalkyle/types"

/** Alt om kalkylene på ett prosjekt. Brukes til «Angre» etter sletting. */
export type KalkyleTilstand = {
  kalkyler: Kalkyle[]
  aktivId: string | null
  tilbud: TilbudSnapshot[]
}

type KalkyleContextValue = {
  /** Den valgte kalkylen. Null før prosjektet har noen (da vises startskjermen). */
  kalkyle: Kalkyle | null
  resultat: KalkyleResultat | null
  /** Erstatter innholdet i den valgte kalkylen (eller legger til, hvis ingen finnes). */
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

  // ── Flere kalkyler på prosjektet ──
  kalkyler: Kalkyle[]
  velgKalkyle: (id: string) => void
  /** Legger til en ny kalkyle på prosjektet og velger den. */
  leggTilKalkyle: (kalkyle: Kalkyle) => void
  endreKalkyleNavn: (navn: string) => void
  fjernKalkyle: (id: string) => void
  tilstand: KalkyleTilstand
  settTilstand: (tilstand: KalkyleTilstand) => void

  // ── Tilbud (versjoner) per kalkyle ──
  /** Tilbudene til den valgte kalkylen, nyeste sist. */
  tilbud: TilbudSnapshot[]
  /** Fryser den valgte kalkylen og valgene som et nytt tilbud. Returnerer id-en. */
  lagreTilbud: (valg: { navn?: string; detaljniva: Detaljniva; visTimer: boolean }) => string | null
  settTilbudStatus: (tilbudId: string, status: TilbudStatus) => void
}

const KalkyleContext = React.createContext<KalkyleContextValue | null>(null)

const STANDARD_ENHET: Record<LinjeType, Linje["enhet"]> = { arbeid: "t", materiell: "stk", ue: "rs", jobb: "stk" }

const idag = () => new Date().toISOString().slice(0, 10)

/**
 * Holder kalkylene på prosjektet i minnet mens de redigeres (mock-runden:
 * ingen lagring). Alt innhold går gjennom brukEndringer, så skjema, ark og
 * chat endrer kalkylen likt. Ligger rundt både Kalkyle og Etterkalkyle, så
 * fanene ser de samme kalkylene.
 */
export function KalkyleProvider({
  initial,
  initialKalkyler,
  initialTilbud = [],
  children,
}: {
  initial?: Kalkyle | null
  initialKalkyler?: Kalkyle[]
  initialTilbud?: TilbudSnapshot[]
  children: React.ReactNode
}) {
  const [tilstand, setTilstand] = React.useState<KalkyleTilstand>(() => {
    const kalkyler = initialKalkyler ?? (initial ? [initial] : [])
    return { kalkyler, aktivId: kalkyler[0]?.id ?? null, tilbud: initialTilbud }
  })
  const [merket, setMerket] = React.useState<ReadonlySet<string>>(() => new Set())
  // Siste verdi uten å vente på ny render, så to endringer i samme klikk ikke
  // overskriver hverandre. Oppdateres bare via `sett`.
  const ref = React.useRef(tilstand)

  const sett = React.useCallback((neste: KalkyleTilstand) => {
    ref.current = neste
    setTilstand(neste)
  }, [])

  const aktiv = () => ref.current.kalkyler.find((k) => k.id === ref.current.aktivId) ?? null

  /** Bytter ut den valgte kalkylen (eller legger den til). */
  const settAktiv = React.useCallback(
    (neste: Kalkyle | null) => {
      const t = ref.current
      if (!neste) {
        sett({ ...t, kalkyler: t.kalkyler.filter((k) => k.id !== t.aktivId), aktivId: null })
        return
      }
      const finnes = t.kalkyler.some((k) => k.id === t.aktivId)
      sett(
        finnes
          ? { ...t, kalkyler: t.kalkyler.map((k) => (k.id === t.aktivId ? { ...neste, id: k.id, navn: neste.navn || k.navn } : k)) }
          : { ...t, kalkyler: [...t.kalkyler, neste], aktivId: neste.id }
      )
    },
    [sett]
  )

  const endre = React.useCallback(
    (endringer: KalkyleEndring[]) => {
      const k = aktiv()
      if (!k) return []
      const r = brukEndringer(k, endringer)
      settAktiv(r.kalkyle)
      return r.berort
    },
    [settAktiv]
  )

  const value = React.useMemo<KalkyleContextValue>(() => {
    const kalkyle = tilstand.kalkyler.find((k) => k.id === tilstand.aktivId) ?? null
    const finnPost = (postId: string) => aktiv()?.poster.find((p) => p.id === postId)
    return {
      kalkyle,
      resultat: kalkyle ? beregnKalkyle(kalkyle) : null,
      settKalkyle: (k) => {
        settAktiv(k)
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
        const for_ = new Set(aktiv()?.poster.map((p) => p.id))
        endre([{ type: "nyPost", navn }])
        return aktiv()?.poster.find((p) => !for_.has(p.id))?.id ?? null
      },
      oppdaterPost: (postId, navn) => {
        const k = aktiv()
        if (!k || !finnPost(postId)) return
        settAktiv({ ...k, poster: k.poster.map((p) => (p.id === postId ? { ...p, navn } : p)) })
      },
      fjernPost: (postId) => {
        const k = aktiv()
        if (!k) return
        settAktiv({ ...k, poster: k.poster.filter((p) => p.id !== postId) })
      },
      merket,
      merk: (ider) => setMerket((prev) => new Set([...prev, ...ider])),

      kalkyler: tilstand.kalkyler,
      velgKalkyle: (id) => {
        if (!ref.current.kalkyler.some((k) => k.id === id)) return
        sett({ ...ref.current, aktivId: id })
        setMerket(new Set())
      },
      leggTilKalkyle: (k) => {
        sett({ ...ref.current, kalkyler: [...ref.current.kalkyler, k], aktivId: k.id })
        setMerket(new Set())
      },
      endreKalkyleNavn: (navn) => {
        const k = aktiv()
        if (k) settAktiv({ ...k, navn })
      },
      fjernKalkyle: (id) => {
        const t = ref.current
        const kalkyler = t.kalkyler.filter((k) => k.id !== id)
        sett({
          kalkyler,
          aktivId: t.aktivId === id ? (kalkyler[0]?.id ?? null) : t.aktivId,
          tilbud: t.tilbud.filter((o) => o.kalkyle.id !== id),
        })
      },
      tilstand,
      settTilstand: sett,

      tilbud: kalkyle ? tilstand.tilbud.filter((o) => o.kalkyle.id === kalkyle.id) : [],
      lagreTilbud: ({ navn, detaljniva, visTimer }) => {
        const k = aktiv()
        if (!k) return null
        const egne = ref.current.tilbud.filter((o) => o.kalkyle.id === k.id)
        const versjon = Math.max(0, ...egne.map((o) => o.versjon)) + 1
        const id = `tilbud-${k.id}-${versjon}`
        const nytt: TilbudSnapshot = {
          id,
          navn: navn?.trim() || `v${versjon}`,
          versjon,
          status: "utkast",
          // Frossen kopi: senere endringer i kalkylen påvirker ikke dette tilbudet.
          kalkyle: structuredClone(k),
          detaljniva,
          visTimer,
          opprettet: idag(),
          sendtDato: null,
          signertDato: null,
          erLast: false,
        }
        sett({ ...ref.current, tilbud: [...ref.current.tilbud, nytt] })
        return id
      },
      settTilbudStatus: (tilbudId, status) => {
        sett({
          ...ref.current,
          tilbud: ref.current.tilbud.map((o) =>
            o.id !== tilbudId
              ? o
              : {
                  ...o,
                  status,
                  sendtDato: status === "sendt" ? idag() : o.sendtDato,
                  signertDato: status === "signert" ? idag() : o.signertDato,
                  erLast: status === "signert" || o.erLast,
                }
          ),
        })
      },
    }
  }, [tilstand, merket, endre, settAktiv, sett])

  return <KalkyleContext.Provider value={value}>{children}</KalkyleContext.Provider>
}

export function useKalkyle() {
  const value = React.useContext(KalkyleContext)
  if (!value) throw new Error("useKalkyle må brukes inne i <KalkyleProvider>")
  return value
}

/** Om komponenten allerede ligger inne i en KalkyleProvider (delt mellom fanene). */
export function useHarKalkyleKontekst() {
  return React.useContext(KalkyleContext) !== null
}
