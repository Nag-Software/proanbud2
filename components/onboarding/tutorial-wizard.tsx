"use client"

// Omvisningen for nye brukere, i tre deler:
//  1. Velkomstkort med fornavnet.
//  2. En interaktiv tur på fem korte steg (lib/onboarding/omvisning.ts):
//     prosjektene, kalkylen og oppsettet av bedriften. Brukeren trykker selv i
//     appen; lysfeltet viser hvor, og steget er gjort når appen er der
//     (adressen, den åpne fanen) — uansett hvordan brukeren kom dit. Appen er
//     aldri sperret. Er en meny eller et skjema åpent, trer guiden til side.
//  3. «Kom i gang»-listen (kom-i-gang.tsx), som krysses av når ting faktisk
//     er gjort.
//
// Lysfeltet er et hull i en SVG-maske (evenodd) uten pekerhendelser, så alt
// under kan trykkes på. Posisjonen følges i en rAF-løkke som skriver rett til
// DOM-en (ingen re-render per bilde).
//
// Vises for admin/prosjektleder til listen er fullført eller skjult
// (user_profiles.tutorial_completed_at, db/67). `?mock=tutorial` tvinger fram en
// frisk kjøring i dev uten å skrive noe. Portalen går til #pa-overlay-root.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowRightIcon,
  Building2Icon,
  CalculatorIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  LaptopIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { useAuth } from "@/components/auth-provider"
import { KomIGang, useKomIGangStatus } from "@/components/onboarding/kom-i-gang"
import { useUserRole } from "@/hooks/use-user-role"
import { createClient } from "@/lib/supabase/client"
import { isRoleMockEnabled } from "@/lib/auth/role-mock"
import { track } from "@/lib/analytics/track"
import { reportClientError } from "@/lib/errors/client"
import { KALKYLE_ENABLED } from "@/lib/kalkyle/flag"
import {
  glid,
  plasserKort,
  turStegFor,
  type Rekt,
  type Side,
  type TurIkon,
  type TurKontekst,
  type TurSteg,
} from "@/lib/onboarding/omvisning"
import { cn } from "@/lib/utils"

/** Starter turen på nytt (lyttes på her, sendes fra brukermenyen). */
export const START_TUTORIAL_EVENT = "pa:start-tutorial"

const LAGER_PREFIX = "pa_omvisning_v2:"

type Lagret = { turFerdig: boolean; liten: boolean }

// Hvor langt brukeren har kommet, per bruker i localStorage. Mistes det, får
// brukeren bare velkomstkortet igjen. Fullført/skjult ligger i databasen.
function lesLagret(userId: string): Lagret {
  try {
    const raw = window.localStorage.getItem(LAGER_PREFIX + userId)
    const parsed = raw ? (JSON.parse(raw) as Partial<Lagret>) : {}
    return { turFerdig: parsed.turFerdig === true, liten: parsed.liten === true }
  } catch {
    return { turFerdig: false, liten: false }
  }
}

function skrivLagret(userId: string, verdi: Lagret) {
  try {
    window.localStorage.setItem(LAGER_PREFIX + userId, JSON.stringify(verdi))
  } catch {
    // Full eller blokkert lagring: bare en bekvemmelighet.
  }
}

type Fase = "av" | "velkommen" | "tur" | "liste"

const ingenLytting = () => () => {}

// En tur som pågår, lagret for fanen (sessionStorage). Lastes siden på nytt
// — eller bygges komponenten på nytt — fortsetter turen der den var, i stedet
// for at guiden forsvinner. Gjelder også `?mock=tutorial`, som er borte fra
// adressen etter første sidebytte.
const AKTIV_NOKKEL = "pa_omvisning_aktiv"
const AKTIV_MAKS_ALDER_MS = 2 * 60 * 60_000

type AktivTur = {
  userId: string
  steg: number
  prosjekt: TurKontekst["prosjekt"]
  mock: boolean
  lagret: number
}

function lesAktivTur(userId: string): AktivTur | null {
  try {
    const raw = window.sessionStorage.getItem(AKTIV_NOKKEL)
    const tur = raw ? (JSON.parse(raw) as AktivTur) : null
    if (!tur || tur.userId !== userId || Date.now() - tur.lagret > AKTIV_MAKS_ALDER_MS) return null
    return tur
  } catch {
    return null
  }
}

function skrivAktivTur(tur: AktivTur | null) {
  try {
    if (tur) window.sessionStorage.setItem(AKTIV_NOKKEL, JSON.stringify(tur))
    else window.sessionStorage.removeItem(AKTIV_NOKKEL)
  } catch {
    // Blokkert lagring: turen virker, men overlever ikke en ny innlasting.
  }
}

/** Det turen ser av appen akkurat nå: adressen og den åpne prosjektfanen. */
function lesSide(): Side {
  const fane = document
    .querySelector<HTMLElement>('[role="tab"][aria-selected="true"][data-tour^="fane-"]')
    ?.getAttribute("data-tour")
  return { sti: window.location.pathname, aktivFane: fane ? fane.slice("fane-".length) : null }
}

export function TutorialWizard() {
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useAuth()
  const { canonicalRole, roleKnown } = useUserRole()
  const { isMobile } = useSidebar()

  // Portalen kan først tegnes på klienten (document finnes ikke på serveren).
  const mounted = useSyncExternalStore(ingenLytting, () => true, () => false)
  const [fase, setFase] = useState<Fase>("av")
  const [steg, setSteg] = useState(0)
  const [liten, setLiten] = useState(false)
  const [fornavn, setFornavn] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [prosjekt, setProsjekt] = useState<TurKontekst["prosjekt"]>(null)

  // ?mock=tutorial: vis alt, men skriv ingenting (verken DB eller localStorage).
  const mockRef = useRef(false)
  // Fasen slik den er nå, for tidtakere som ikke skal overstyre det som vises.
  const faseRef = useRef<Fase>("av")
  useEffect(() => {
    faseRef.current = fase
  }, [fase])

  // Turen peker på leder-navigasjonen; håndverkere har verken målene eller tilgangene.
  const eligible = roleKnown && (canonicalRole === "admin" || canonicalRole === "manager")

  // Skal omvisningen vises? Keyet på bruker-ID (user-objektet byttes ved
  // token-refresh) og uten «allerede sjekket»-ref: StrictMode i dev kjører
  // effekten dobbelt, og en ref-guard ville hoppet over andre kjøring.
  const userId = user?.id ?? null
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const timers: Array<ReturnType<typeof setTimeout>> = []

    const hentBruker = async () => {
      const { data } = await createClient()
        .from("users")
        .select("company_id, full_name")
        .eq("id", userId)
        .maybeSingle()
      if (cancelled) return
      setCompanyId(data?.company_id ?? null)
      const navn = data?.full_name?.trim().split(/\s+/)[0]
      if (navn) setFornavn(navn)
    }

    // En tur som allerede pågår i denne fanen, tas opp igjen med en gang.
    const aktiv = lesAktivTur(userId)
    if (aktiv && (aktiv.mock || eligible)) {
      mockRef.current = aktiv.mock
      void hentBruker()
      timers.push(
        setTimeout(() => {
          if (cancelled) return
          setProsjekt(aktiv.prosjekt)
          setSteg(aktiv.steg)
          setFase("tur")
        }, 0)
      )
      return () => {
        cancelled = true
        timers.forEach(clearTimeout)
      }
    }

    // Første visning settes bare når ingenting annet vises: kjører sjekken på
    // nytt (rollen lastes på nytt o.l.), skal den aldri ta en tur fra brukeren.
    const visForst = (neste: Fase) => {
      if (faseRef.current === "av") setFase(neste)
    }

    const mockParam =
      isRoleMockEnabled() && new URLSearchParams(window.location.search).get("mock") === "tutorial"

    if (mockParam) {
      // Eksplisitt dev-forespørsel: vis uavhengig av `eligible`, så en
      // gjenliggende rolle-mock aldri kan gjemme det man ber om.
      mockRef.current = true
      void hentBruker()
      timers.push(setTimeout(() => visForst("velkommen"), 400))
    } else if (eligible) {
      ;(async () => {
        const { data, error } = await createClient()
          .from("user_profiles")
          .select("tutorial_completed_at")
          .eq("user_id", userId)
          .maybeSingle()
        // Ved lesefeil viser vi heller ingenting enn å mase ved hver innlogging.
        if (cancelled || error || data?.tutorial_completed_at) return
        void hentBruker()
        const lagret = lesLagret(userId)
        // Liten pust så dashbordet rekker å male før kortet legger seg over.
        timers.push(
          setTimeout(() => {
            if (cancelled || faseRef.current !== "av") return
            setLiten(lagret.liten)
            setFase(lagret.turFerdig ? "liste" : "velkommen")
          }, 900)
        )
      })()
    }

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [userId, eligible])

  const lagre = useCallback(
    (verdi: Lagret) => {
      if (user && !mockRef.current) skrivLagret(user.id, verdi)
    },
    [user]
  )

  /** Firmaets nyeste prosjekt — dit «Hopp over» går på prosjektstegene. */
  const hentProsjekt = useCallback(async (): Promise<TurKontekst["prosjekt"]> => {
    if (!user) return null
    const supabase = createClient()
    let firma = companyId
    if (!firma) {
      const { data } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
      firma = data?.company_id ?? null
      setCompanyId(firma)
    }
    if (!firma) return null
    const { data } = await supabase
      .from("projects")
      .select("id, name")
      .eq("company_id", firma)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ? { id: data.id, navn: data.name || "prosjektet" } : null
  }, [companyId, user])

  const startTur = useCallback(() => {
    track("omvisning_startet")
    setSteg(0)
    void hentProsjekt().then((funnet) => {
      setProsjekt(funnet)
      setFase("tur")
    })
  }, [hentProsjekt])

  // «Start omvisningen» fra brukermenyen: rett inn i turen, uten å røre DB-flagget.
  useEffect(() => {
    const onRestart = () => {
      if (!eligible && !mockRef.current) return
      startTur()
    }
    window.addEventListener(START_TUTORIAL_EVENT, onRestart)
    return () => window.removeEventListener(START_TUTORIAL_EVENT, onRestart)
  }, [eligible, startTur])

  /** Listen er fullført eller skjult: aldri vis automatisk igjen. */
  const avslutt = useCallback(
    (utfall: "fullfort" | "avvist") => {
      setFase("av")
      track(utfall === "fullfort" ? "omvisning_fullfort" : "omvisning_avvist")
      if (mockRef.current || !user) return
      createClient()
        .from("user_profiles")
        .upsert({ user_id: user.id, tutorial_completed_at: new Date().toISOString() }, { onConflict: "user_id" })
        .then(({ error }) => {
          if (error) {
            reportClientError(error, { context: { action: "lagre omvisningsstatus" }, level: "warning" })
          }
        })
    },
    [user]
  )

  const stegListe = useMemo(() => turStegFor({ prosjekt, kalkyle: KALKYLE_ENABLED }), [prosjekt])
  const naaSteg: TurSteg | undefined = stegListe[steg]

  const avsluttTur = useCallback(
    (fullfort: boolean) => {
      track("omvisning_tur_ferdig", { fullfort, steg: stegListe[steg]?.key })
      setLiten(false)
      lagre({ turFerdig: true, liten: false })
      setFase("liste")
    },
    [lagre, steg, stegListe]
  )

  const settLiten = useCallback(
    (verdi: boolean) => {
      setLiten(verdi)
      lagre({ turFerdig: true, liten: verdi })
    },
    [lagre]
  )

  const status = useKomIGangStatus(companyId, fase === "liste", fase === "liste" && !liten)

  // Hold turen lagret for fanen mens den pågår (se lesAktivTur).
  const forrigeFase = useRef<Fase>("av")
  useEffect(() => {
    if (fase === "tur" && userId) {
      skrivAktivTur({ userId, steg, prosjekt, mock: mockRef.current, lagret: Date.now() })
    } else if (forrigeFase.current === "tur") {
      skrivAktivTur(null)
    }
    forrigeFase.current = fase
  }, [fase, prosjekt, steg, userId])

  // Steget er gjort når appen er der det skal (uansett hvordan brukeren kom
  // dit). Steg som alt er oppfylt — brukeren står på prosjektsiden når turen
  // starter — hoppes rett over.
  useEffect(() => {
    if (fase !== "tur") return
    const sjekk = () => {
      const side = lesSide()
      let neste = steg
      while (neste < stegListe.length && stegListe[neste].ferdig?.(side)) {
        track("omvisning_steg_fullfort", { steg: stegListe[neste].key })
        neste++
      }
      if (neste === steg) return
      if (neste >= stegListe.length) avsluttTur(true)
      else setSteg(neste)
    }
    sjekk()
    const timer = window.setInterval(sjekk, 250)
    return () => window.clearInterval(timer)
  }, [avsluttTur, fase, pathname, steg, stegListe])

  useEffect(() => {
    if (fase === "tur" && naaSteg) track("omvisning_steg_startet", { steg: naaSteg.key })
  }, [fase, naaSteg])

  // Et steg som ikke finnes (en gammel lagret tur): avslutt pent i stedet for
  // å stå igjen med en usynlig tur.
  useEffect(() => {
    if (fase !== "tur" || naaSteg) return
    const timer = setTimeout(() => avsluttTur(false), 0)
    return () => clearTimeout(timer)
  }, [avsluttTur, fase, naaSteg])

  /** «Hopp over»: ta brukeren dit steget fører, eller gå videre når det ikke går. */
  const hoppOver = useCallback(() => {
    if (!naaSteg) return
    track("omvisning_steg_hoppet_over", { steg: naaSteg.key })
    const mal = naaSteg.hopp?.(lesSide())
    if (mal) {
      router.push(mal)
      return
    }
    if (steg + 1 >= stegListe.length) avsluttTur(false)
    else setSteg(steg + 1)
  }, [avsluttTur, naaSteg, router, steg, stegListe.length])

  if (!mounted || fase === "av") return null

  const portalHost = document.getElementById("pa-overlay-root") ?? document.body

  return createPortal(
    <>
      {fase === "velkommen" && (
        <Velkomst
          fornavn={fornavn}
          onStart={startTur}
          onSenere={() => {
            track("omvisning_utsatt")
            lagre({ turFerdig: true, liten: true })
            setLiten(true)
            setFase("liste")
          }}
        />
      )}

      {fase === "tur" && naaSteg && (
        <Tur
          steg={naaSteg}
          index={steg}
          antall={stegListe.length}
          mobil={isMobile}
          onHoppOver={hoppOver}
          onFerdig={() => avsluttTur(true)}
          onAvslutt={() => avsluttTur(false)}
        />
      )}

      {fase === "liste" && (
        <KomIGang
          status={status}
          liten={liten}
          onLiten={settLiten}
          onTur={startTur}
          onFerdig={() => avslutt("fullfort")}
          onSkjul={() => avslutt("avvist")}
        />
      )}
    </>,
    portalHost
  )
}

// ---------------------------------------------------------------------------
// Velkomstkortet
// ---------------------------------------------------------------------------

const REISEN = [
  { ikon: FolderIcon, navn: "Prosjekter" },
  { ikon: CalculatorIcon, navn: "Kalkyle" },
  { ikon: Building2Icon, navn: "Bedriften" },
]

function Velkomst({ fornavn, onStart, onSenere }: { fornavn: string | null; onStart: () => void; onSenere: () => void }) {
  const startRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    startRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSenere()
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [onSenere])

  return (
    <div
      className="fixed inset-0 z-[97] flex items-center justify-center bg-foreground/45 p-4 backdrop-blur-[2px] animate-in fade-in-0 duration-300"
      role="dialog"
      aria-modal="true"
      aria-labelledby="omvisning-velkommen"
    >
      <div className="relative w-[440px] max-w-full overflow-hidden rounded-[18px] border bg-background shadow-2xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-500">
        <button
          type="button"
          onClick={onSenere}
          className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Lukk"
        >
          <XIcon className="size-4" />
        </button>

        <div className="relative flex h-32 items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-10">
          <div className="absolute inset-x-16 top-1/2 h-px -translate-y-3 bg-gradient-to-r from-primary/10 via-primary/40 to-primary/10" aria-hidden />
          <ol className="relative flex w-full items-start justify-between">
            {REISEN.map(({ ikon: Ikon, navn }, i) => (
              <li
                key={navn}
                className="flex flex-col items-center gap-1.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-500"
                style={{ animationDelay: `${150 + i * 110}ms`, animationFillMode: "both" }}
              >
                <span className="flex size-11 items-center justify-center rounded-[12px] border bg-background text-primary shadow-sm">
                  <Ikon className="size-5" strokeWidth={1.8} />
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">{navn}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className="p-6 pt-5">
          <h2 id="omvisning-velkommen" className="text-[22px] font-semibold tracking-tight text-balance">
            {fornavn ? `Velkommen, ${fornavn}` : "Velkommen til Proanbud"} 👋
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
            Fem korte steg: prosjektene, kalkylen og oppsettet av bedriften. Du trykker selv i appen, vi viser hvor.
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" size="lg" className="sm:flex-none" onClick={onSenere}>
              Utforsk selv
            </Button>
            <Button ref={startRef} size="lg" className="flex-1 gap-1.5" onClick={onStart}>
              Start omvisningen
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
          <p className="mt-4 flex items-start gap-2 text-[12px] text-muted-foreground">
            <LaptopIcon className="mt-px size-3.5 shrink-0" strokeWidth={1.8} />
            Proanbud er best og mest oversiktlig på datamaskin.
          </p>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Turen
// ---------------------------------------------------------------------------

const IKONER: Record<TurIkon, typeof FolderIcon> = {
  prosjekter: FolderIcon,
  prosjekt: FolderOpenIcon,
  kalkyle: CalculatorIcon,
  okonomi: WalletIcon,
  bedrift: Building2Icon,
  logo: ImageIcon,
}

const KORT_BREDDE = 320
const LUFT = 6
/** Så lenge får det beste målet på å laste før et reservemål brukes. */
const VENT_PA_BESTE_MS = 2500

/** Første synlige element for selektorene, i prioritert rekkefølge (med plassen i lista). */
function finnSynlig(selektorer: string[]): { el: HTMLElement; indeks: number } | null {
  for (let indeks = 0; indeks < selektorer.length; indeks++) {
    for (const el of document.querySelectorAll<HTMLElement>(selektorer[indeks])) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return { el, indeks }
    }
  }
  return null
}

/** En åpen dialog, meny eller skuff i appen (ikke vår egen). */
function fremmedLag(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"]'
  )) {
    if (!el.closest("#pa-overlay-root")) return el
  }
  return null
}

function avrundetRekt({ x, y, b, h }: Rekt, radius: number): string {
  const r = Math.min(radius, b / 2, h / 2)
  return (
    `M${x + r} ${y}H${x + b - r}A${r} ${r} 0 0 1 ${x + b} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + b - r} ${y + h}H${x + r}` +
    `A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`
  )
}

function Tur({
  steg,
  index,
  antall,
  mobil,
  onHoppOver,
  onFerdig,
  onAvslutt,
}: {
  steg: TurSteg
  index: number
  antall: number
  mobil: boolean
  onHoppOver: () => void
  onFerdig: () => void
  onAvslutt: () => void
}) {
  const maskeRef = useRef<SVGPathElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const kortRef = useRef<HTMLDivElement | null>(null)
  // Hullet og kortet beholder posisjonen mellom stegene, så de glir videre fra
  // forrige mål i stedet for å hoppe.
  const hullRef = useRef<Rekt | null>(null)
  const kortPosRef = useRef<{ x: number; y: number } | null>(null)
  const Ikon = IKONER[steg.ikon]
  const manuelt = !steg.ferdig

  // Følg målet hvert bilde. Rolig: ett mål per steg, og kortet flytter seg
  // bare når målet er funnet.
  //  - Det beste målet får tid til å laste før et reservemål brukes, og målet
  //    må ligge stille et øyeblikk, så lasting som flytter innhold ikke drar
  //    lysfeltet med seg.
  //  - Unntaket er `deretter` (punktet i «Mer»-menyen): det er neste trykk
  //    brukeren skal gjøre, og vinner med en gang det synes.
  //  - Er en meny eller dialog åpen som målet ikke ligger i, trer guiden til
  //    side (usynlig) til den er lukket.
  //  - Uten mål er skjermen ikke mørklagt, og kortet står nede i hjørnet.
  useEffect(() => {
    let raf = 0
    let forrige = performance.now()
    const start = forrige
    let hull = hullRef.current
    let kort = kortPosRef.current
    let el: HTMLElement | null = null
    let valgtIndeks = Infinity
    let kandidat: { el: HTMLElement; x: number; y: number; siden: number } | null = null
    let sistLett = 0
    let rulleforsok = 0
    let sistRullet = -Infinity

    const velgMal = (naa: number) => {
      if (naa - sistLett < 100) return
      sistLett = naa
      // Neste trykk i samme steg (åpnet meny) vinner med en gang.
      const deretter = steg.deretter ? finnSynlig([steg.deretter]) : null
      if (deretter) {
        el = deretter.el
        return
      }
      if (el && (!el.isConnected || (steg.deretter && el.matches(steg.deretter)))) el = null
      if (el) return
      const funnet = finnSynlig(steg.mal)
      if (!funnet) {
        kandidat = null
        return
      }
      const r = funnet.el.getBoundingClientRect()
      const sammeSom =
        kandidat && kandidat.el === funnet.el && Math.abs(kandidat.x - r.left) < 2 && Math.abs(kandidat.y - r.top) < 2
      if (!sammeSom) {
        kandidat = { el: funnet.el, x: r.left, y: r.top, siden: naa }
        return
      }
      const stille = naa - kandidat!.siden > 150
      const godtNok = funnet.indeks === 0 || naa - start > VENT_PA_BESTE_MS || valgtIndeks !== Infinity
      if (stille && godtNok) {
        el = funnet.el
        valgtIndeks = funnet.indeks
        rulleforsok = 0
      }
    }

    const tick = (naa: number) => {
      const dt = Math.min(naa - forrige, 64)
      forrige = naa
      const k = 1 - Math.exp(-dt / 85)
      const vb = window.innerWidth
      const vh = window.innerHeight

      velgMal(naa)
      const lag = fremmedLag()
      const skjult = lag !== null && !(el && lag.contains(el))
      const r = el && !skjult ? el.getBoundingClientRect() : null
      const malRekt: Rekt | null =
        r && r.width > 0 ? { x: r.left - LUFT, y: r.top - LUFT, b: r.width + LUFT * 2, h: r.height + LUFT * 2 } : null

      // Ligger målet utenfor skjermen, rull dit (et par forsøk, i tilfelle
      // siden selv ruller et annet sted mens den laster).
      if (el && r && (r.top < 0 || r.bottom > vh) && rulleforsok < 4 && naa - sistRullet > 700) {
        rulleforsok++
        sistRullet = naa
        el.scrollIntoView({ block: r.height > vh * 0.8 ? "start" : "center", behavior: "smooth" })
      }

      if (malRekt) {
        hull = hull ? glid(hull, malRekt, k) : { x: malRekt.x + malRekt.b / 2, y: malRekt.y + malRekt.h / 2, b: 0, h: 0 }
      } else if (hull) {
        hull = glid(hull, { x: hull.x + hull.b / 2, y: hull.y + hull.h / 2, b: 0, h: 0 }, k)
        if (hull.b < 1) hull = null
      }

      // Mørklegg bare når det finnes noe å peke på.
      const maske = maskeRef.current
      if (maske) {
        maske.setAttribute("d", hull ? `M0 0H${vb}V${vh}H0Z` + avrundetRekt(hull, 10) : "")
      }
      const ring = ringRef.current
      if (ring) {
        ring.style.opacity = hull && malRekt ? "1" : "0"
        if (hull) {
          ring.style.transform = `translate(${hull.x - 2}px, ${hull.y - 2}px)`
          ring.style.width = `${hull.b + 4}px`
          ring.style.height = `${hull.h + 4}px`
        }
      }

      const kortEl = kortRef.current
      if (kortEl) {
        const plass = plasserKort(malRekt, { b: KORT_BREDDE, h: kortEl.offsetHeight }, { b: vb, h: vh }, mobil)
        kort = kort ? { x: kort.x + (plass.x - kort.x) * k, y: kort.y + (plass.y - kort.y) * k } : { x: plass.x, y: plass.y }
        kortEl.style.width = `${plass.b}px`
        kortEl.style.transform = `translate(${kort.x}px, ${kort.y}px)`
        // Første gang venter kortet et øyeblikk på målet, så det ikke hopper.
        const vis = !skjult && (malRekt || naa - start > 600 || kortPosRef.current)
        kortEl.style.opacity = vis ? "1" : "0"
        kortEl.style.pointerEvents = vis ? "auto" : "none"
      }
      hullRef.current = hull
      if (kortEl?.style.opacity === "1") kortPosRef.current = kort
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [mobil, steg])

  // Esc avslutter turen (når ingen meny eller dialog i appen er åpen).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !fremmedLag()) onAvslutt()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onAvslutt])

  return (
    <>
      {/* Bare en skygge: alt under kan trykkes på, også utenfor lysfeltet. */}
      <svg className="pointer-events-none fixed inset-0 z-[94] h-full w-full" aria-hidden="true">
        <path ref={maskeRef} fillRule="evenodd" className="fill-foreground/35" d="" />
      </svg>
      <div
        ref={ringRef}
        className="pointer-events-none fixed left-0 top-0 z-[95] rounded-[12px] border-2 border-primary ring-4 ring-primary/15"
        style={{ opacity: 0 }}
        aria-hidden="true"
      >
        <span
          className="absolute -inset-[3px] rounded-[14px] border-2 border-primary/60 motion-reduce:hidden"
          style={{ animation: "pa-tour-pulse 1.8s ease-out infinite" }}
        />
      </div>

      <div
        ref={kortRef}
        className="fixed left-0 top-0 z-[96] transition-opacity duration-200"
        // Usynlig og uten treff til første bilde har plassert det.
        style={{ opacity: 0, width: KORT_BREDDE, pointerEvents: "none" }}
        role="dialog"
        aria-labelledby="omvisning-tittel"
      >
        <div className="rounded-[14px] border bg-popover p-4 text-popover-foreground shadow-2xl">
          <div key={index} className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300" aria-live="polite">
            <div className="flex items-start gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
                <Ikon className="size-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 id="omvisning-tittel" className="text-[15px] font-semibold leading-tight tracking-tight">
                  {steg.tittel}
                </h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{steg.tekst}</p>
              </div>
              <button
                type="button"
                onClick={onAvslutt}
                className="-mr-1.5 -mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Avslutt omvisningen"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          </div>

          <div className="mt-3.5 flex items-center gap-2">
            <div className="flex flex-1 items-center gap-1" aria-label={`Steg ${index + 1} av ${antall}`}>
              {Array.from({ length: antall }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === index ? "w-5 bg-primary" : i < index ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted-foreground/25"
                  )}
                />
              ))}
            </div>
            {manuelt ? (
              <Button type="button" size="sm" className="h-8 px-3.5" onClick={onFerdig}>
                Ferdig
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2.5 text-muted-foreground" onClick={onHoppOver}>
                Hopp over
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
