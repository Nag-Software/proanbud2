"use client"

// Tutorial-veiviser for nye brukere: velkomstkort + «Kom i gang»-panel som
// spotlighter neste klikk i den ekte appen. Utsparingen lages som et hull i en
// SVG-maske — målet forblir klikkbart uansett stacking context, og alt annet
// blokkeres av maskens path. Vises for admin/prosjektleder til den fullføres
// eller avvises (user_profiles.tutorial_completed_at, db/67). `?mock=tutorial`
// tvinger frem en frisk kjøring i dev uten å skrive noe (samme gate som
// rollemocken). Målene finnes via data-tour-attributter i app-sidebar/nav-main.

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { ArrowRightIcon, CheckIcon, LaptopIcon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { useAuth } from "@/components/auth-provider"
import { useUserRole } from "@/hooks/use-user-role"
import { createClient } from "@/lib/supabase/client"
import { isRoleMockEnabled } from "@/lib/auth/role-mock"
import { track } from "@/lib/analytics/track"
import { reportClientError } from "@/lib/errors/client"
import { cn } from "@/lib/utils"

/** Utløser veiviseren på nytt (lyttes på her, sendes fra brukermenyen). */
export const START_TUTORIAL_EVENT = "pa:start-tutorial"

const PROGRESS_PREFIX = "pa_tutorial_v1:"

type TutorialStage = {
  /** data-tour-mål i den ekte appen. */
  selector: string
  /** Teksten brukeren skal klikke på, vist i boblen: Klikk på «…». */
  clickLabel: string
}

type TutorialStep = {
  key: string
  title: string
  body: string
  /** Direkte-navigasjon når spotlight ikke kan brukes (mobil, mål ikke funnet). */
  href: string
  /** Ett eller flere delmål — f.eks. først «Min bedrift», så «Bedriftsprofil». */
  stages: TutorialStage[]
}

const STEPS: TutorialStep[] = [
  {
    key: "firma",
    title: "Sett opp firmaet ditt",
    body: "Logo, timepriser og ansatte legges inn én gang — og gjenbrukes i alle tilbud og kalkyler.",
    href: "/min-bedrift/bedriftsprofil",
    stages: [
      { selector: '[data-tour="min-bedrift"]', clickLabel: "Min bedrift" },
      { selector: '[data-tour="bedriftsprofil"]', clickLabel: "Bedriftsprofil" },
    ],
  },
  {
    key: "prosjekt",
    title: "Opprett et prosjekt",
    body: "Alt i Proanbud henger på prosjektet: tilbud, timer, dokumenter og kundekontakt.",
    href: "/prosjekter/ny",
    stages: [{ selector: '[data-tour="nytt-prosjekt"]', clickLabel: "Nytt prosjekt" }],
  },
  {
    key: "tilbud",
    title: "Lag og send tilbud",
    body: "Profesjonelt tilbudsdokument på minutter. Kunden godkjenner digitalt — rett fra e-posten.",
    href: "/tilbud",
    stages: [{ selector: '[data-tour="tilbud"]', clickLabel: "Tilbud" }],
  },
  {
    key: "timer",
    title: "Før timer på prosjektet",
    body: "Stemple inn og ut, eller før manuelt. Ansatte fører selv — du godkjenner.",
    href: "/timeforing",
    stages: [{ selector: '[data-tour="timeforing"]', clickLabel: "Timeføring" }],
  },
  {
    key: "kunde",
    title: "Hold kontakten med kunden",
    body: "E-post, meldinger og historikk samlet per kunde. Ingenting glipper.",
    href: "/kunder",
    stages: [{ selector: '[data-tour="kunder"]', clickLabel: "Kunder" }],
  },
]

// Fremdrift per bruker i localStorage — mistes den, står bare stegene som
// ugjort igjen. Fullført/avvist (det som betyr noe) ligger i databasen.
function readProgress(userId: string): string[] {
  try {
    const raw = window.localStorage.getItem(PROGRESS_PREFIX + userId)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string" && STEPS.some((s) => s.key === k))
      : []
  } catch {
    return []
  }
}

function writeProgress(userId: string, done: string[]) {
  try {
    window.localStorage.setItem(PROGRESS_PREFIX + userId, JSON.stringify(done))
  } catch {
    // Full/blokkert storage — fremdriften er kun best-effort.
  }
}

function clearProgress(userId: string) {
  try {
    window.localStorage.removeItem(PROGRESS_PREFIX + userId)
  } catch {
    // se over
  }
}

/** Poll etter et synlig element — sidebar-mål kan mangle mens rollen laster. */
function waitForSelector(selector: string, timeoutMs: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const attempt = () => {
      const el = document.querySelector<HTMLElement>(selector)
      if (el && el.getClientRects().length > 0) return resolve(el)
      if (Date.now() - startedAt > timeoutMs) return resolve(null)
      setTimeout(attempt, 80)
    }
    attempt()
  })
}

function roundedRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2)
  return (
    `M${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}` +
    `V${y + h - rr}A${rr} ${rr} 0 0 1 ${x + w - rr} ${y + h}H${x + rr}` +
    `A${rr} ${rr} 0 0 1 ${x} ${y + h - rr}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}Z`
  )
}

type Phase = "off" | "welcome" | "panel" | "spot"

export function TutorialWizard() {
  const router = useRouter()
  const { user } = useAuth()
  const { canonicalRole, roleKnown } = useUserRole()
  const { state: sidebarState, setOpen: setSidebarOpen, isMobile } = useSidebar()

  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<Phase>("off")
  const [doneKeys, setDoneKeys] = useState<string[]>([])
  const [spot, setSpot] = useState<{ step: TutorialStep; stage: number } | null>(null)

  // ?mock=tutorial: vis alt, men skriv ingenting (verken DB eller localStorage).
  const mockRef = useRef(false)

  const maskPathRef = useRef<SVGPathElement | null>(null)
  const ringRef = useRef<HTMLDivElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const arrowRef = useRef<HTMLDivElement | null>(null)
  const welcomeStartRef = useRef<HTMLButtonElement | null>(null)

  // Stegene peker på admin/leder-navigasjonen — workers har verken målene
  // eller tilgangene, så de får aldri veiviseren.
  const eligible = roleKnown && (canonicalRole === "admin" || canonicalRole === "manager")
  const allDone = doneKeys.length === STEPS.length

  useEffect(() => setMounted(true), [])

  // Skal veiviseren vises? Keyet på bruker-ID (ikke user-objektet — det byttes
  // ved token-refresh) og UTEN «allerede sjekket»-ref: StrictMode i dev kjører
  // effekten dobbelt, og en ref-guard ville hoppet over andre kjøring etter at
  // cleanupen fra den første alt hadde ryddet timeren — da vises ingenting.
  const userId = user?.id ?? null
  useEffect(() => {
    if (!userId) return

    let cancelled = false
    const timers: Array<ReturnType<typeof setTimeout>> = []

    const mockParam =
      isRoleMockEnabled() && new URLSearchParams(window.location.search).get("mock") === "tutorial"

    if (mockParam) {
      // Eksplisitt dev-forespørsel — vis uavhengig av `eligible`, så en
      // gjenliggende rolle-mock (eller treg rollehenting) aldri kan gjemme
      // veiviseren man eksplisitt ber om. Middleware nullstiller i tillegg
      // rolle-mock-cookien på ?mock=tutorial, så spotlight-målene finnes.
      mockRef.current = true
      setDoneKeys([])
      timers.push(setTimeout(() => setPhase("welcome"), 400))
    } else if (eligible) {
      ;(async () => {
        const { data, error } = await createClient()
          .from("user_profiles")
          .select("tutorial_completed_at")
          .eq("user_id", userId)
          .maybeSingle()
        // Ved lesefeil (f.eks. db/67 ikke kjørt ennå) viser vi heller
        // ingenting enn å mase på alle ved hver innlogging.
        if (cancelled || error || data?.tutorial_completed_at) return
        const stored = readProgress(userId)
        setDoneKeys(stored)
        // Liten pust så dashbordet rekker å male før kortet legger seg over.
        timers.push(
          setTimeout(() => {
            if (!cancelled) setPhase(stored.length > 0 ? "panel" : "welcome")
          }, 900)
        )
      })()
    }

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [userId, eligible])

  // «Start omvisningen» fra brukermenyen — frisk kjøring uten å røre DB-flagget
  // (veiviseren skal ikke begynne å auto-åpne igjen ved neste innlogging).
  useEffect(() => {
    const onRestart = () => {
      if (!eligible) return
      if (user) clearProgress(user.id)
      setDoneKeys([])
      setSpot(null)
      setPhase("welcome")
    }
    window.addEventListener(START_TUTORIAL_EVENT, onRestart)
    return () => window.removeEventListener(START_TUTORIAL_EVENT, onRestart)
  }, [eligible, user])

  const finish = useCallback(
    (outcome: "fullfort" | "avvist") => {
      setSpot(null)
      setPhase("off")
      track(outcome === "fullfort" ? "omvisning_fullfort" : "omvisning_avvist")
      if (mockRef.current || !user) return
      clearProgress(user.id)
      createClient()
        .from("user_profiles")
        .upsert(
          { user_id: user.id, tutorial_completed_at: new Date().toISOString() },
          { onConflict: "user_id" }
        )
        .then(({ error }) => {
          if (error) {
            reportClientError(error, {
              context: { action: "lagre omvisningsstatus" },
              level: "warning",
            })
          }
        })
    },
    [user]
  )

  const markStepDone = useCallback(
    (key: string) => {
      setDoneKeys((prev) => {
        if (prev.includes(key)) return prev
        const next = [...prev, key]
        if (user && !mockRef.current) writeProgress(user.id, next)
        return next
      })
    },
    [user]
  )

  const startStep = useCallback(
    async (step: TutorialStep) => {
      track("omvisning_steg_startet", { steg: step.key })
      // Mobil: sidebaren ligger i en lukket skuff — pek ikke, ta brukeren dit.
      if (isMobile) {
        markStepDone(step.key)
        router.push(step.href)
        return
      }
      if (sidebarState === "collapsed") {
        setSidebarOpen(true)
        await new Promise((r) => setTimeout(r, 250))
      }
      // Står undermenyen alt åpen (flerstegs mål), pek rett på det siste målet —
      // et klikk på utløseren ville ellers LUKKET den.
      const lastIdx = step.stages.length - 1
      const lastVisible =
        lastIdx > 0 && document.querySelector(step.stages[lastIdx].selector)?.getClientRects().length
      const stage = lastVisible ? lastIdx : 0
      const el = await waitForSelector(step.stages[stage].selector, 2000)
      if (!el) {
        markStepDone(step.key)
        router.push(step.href)
        return
      }
      setSpot({ step, stage })
      setPhase("spot")
    },
    [isMobile, sidebarState, setSidebarOpen, markStepDone, router]
  )

  const backToPanel = useCallback(() => {
    setSpot(null)
    setPhase("panel")
  }, [])

  // Spotlight: fang klikket på målet (capture på document — den ekte
  // handlingen, navigasjon/ekspandering, skjer uforstyrret etterpå).
  useEffect(() => {
    if (phase !== "spot" || !spot) return
    const { step, stage } = spot
    const selector = step.stages[stage].selector
    let alive = true

    const onClickCapture = (e: MouseEvent) => {
      const el = document.querySelector(selector)
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return
      if (stage + 1 < step.stages.length) {
        // Delmål truffet (f.eks. «Min bedrift» ekspanderte) — vent på neste.
        waitForSelector(step.stages[stage + 1].selector, 2500).then((nextEl) => {
          if (!alive) return
          if (nextEl) {
            setSpot({ step, stage: stage + 1 })
          } else {
            markStepDone(step.key)
            router.push(step.href)
            backToPanel()
          }
        })
      } else {
        track("omvisning_steg_fullfort", { steg: step.key })
        markStepDone(step.key)
        backToPanel()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") backToPanel()
    }
    document.addEventListener("click", onClickCapture, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      alive = false
      document.removeEventListener("click", onClickCapture, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [phase, spot, markStepDone, backToPanel, router])

  // Følg målet hver frame (sidebar-animasjoner, ekspanderende undermenyer,
  // resize) — muterer refs direkte så vi slipper re-render per frame.
  useEffect(() => {
    if (phase !== "spot" || !spot) return
    const selector = spot.step.stages[spot.stage].selector
    const PAD = 6
    let raf = 0
    const tick = () => {
      const el = document.querySelector<HTMLElement>(selector)
      const rect = el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null
      if (!rect) {
        // Målet forsvant (f.eks. resize til mobil) — tilbake til panelet.
        backToPanel()
        return
      }
      const vw = window.innerWidth
      const vh = window.innerHeight
      const x = rect.left - PAD
      const y = rect.top - PAD
      const w = rect.width + PAD * 2
      const h = rect.height + PAD * 2
      maskPathRef.current?.setAttribute("d", `M0 0H${vw}V${vh}H0Z` + roundedRectPath(x, y, w, h, 8))
      if (ringRef.current) {
        const rs = ringRef.current.style
        rs.left = `${x - 2}px`
        rs.top = `${y - 2}px`
        rs.width = `${w + 4}px`
        rs.height = `${h + 4}px`
        rs.opacity = "1"
      }
      const tip = tipRef.current
      if (tip) {
        const top = Math.max(
          12,
          Math.min(rect.top + rect.height / 2 - tip.offsetHeight / 2, vh - tip.offsetHeight - 12)
        )
        tip.style.left = `${rect.right + PAD + 12}px`
        tip.style.top = `${top}px`
        tip.style.opacity = "1"
        if (arrowRef.current) {
          arrowRef.current.style.top = `${Math.max(
            10,
            Math.min(rect.top + rect.height / 2 - top - 6, tip.offsetHeight - 22)
          )}px`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [phase, spot, backToPanel])

  // Esc på velkomstkortet = «Utforsk på egen hånd».
  useEffect(() => {
    if (phase !== "welcome") return
    welcomeStartRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("avvist")
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [phase, finish])

  // Klikk utenfor utsparingen: rist boblen som en pekepinn.
  const shakeTip = useCallback(() => {
    const el = tipRef.current
    if (!el) return
    el.style.animation = "none"
    void el.offsetWidth
    el.style.animation = "pa-tour-shake 0.35s ease"
  }, [])

  if (!mounted || phase === "off") return null

  return createPortal(
    <>
      {phase === "welcome" && (
        <div
          className="fixed inset-0 z-[97] flex items-center justify-center bg-foreground/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Velkommen til Proanbud"
        >
          <div className="relative w-[420px] max-w-full rounded-[10px] bg-background p-7 shadow-2xl">
            <button
              type="button"
              onClick={() => finish("avvist")}
              className="absolute right-3 top-3 rounded p-1 text-muted-foreground/70 hover:text-foreground"
              aria-label="Lukk"
            >
              <XIcon className="h-4 w-4" />
            </button>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Kom i gang · ca. ett minutt
            </p>
            <h2 className="mt-2 text-xl font-bold tracking-tight text-balance">
              Velkommen til Proanbud 👋
            </h2>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              Vi viser deg de fem viktigste stegene — fra firmaoppsett til ferdig tilbud. Du
              klikker deg gjennom appen mens vi peker.
            </p>
            <div className="mt-4 flex items-start gap-2.5 rounded-md border border-border bg-muted/50 p-3 text-[12.5px]">
              <LaptopIcon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
              <span>
                <span className="font-semibold">Tips:</span> Proanbud er best og mest oversiktlig
                på datamaskin. Bruk gjerne PC for full oversikt over prosjekter og tilbud.
              </span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                ref={welcomeStartRef}
                onClick={() => {
                  track("omvisning_startet")
                  setPhase("panel")
                }}
              >
                Start omvisningen
              </Button>
              <Button variant="ghost" onClick={() => finish("avvist")}>
                Utforsk på egen hånd
              </Button>
            </div>
            <p className="mt-4 text-[11.5px] text-muted-foreground/80">
              Du kan avslutte når som helst — og hente frem omvisningen igjen fra brukermenyen.
            </p>
          </div>
        </div>
      )}

      {phase === "panel" && (
        <div
          className="fixed right-4 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-[92] w-[300px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-background shadow-xl md:bottom-4"
          role="dialog"
          aria-label="Kom i gang"
        >
          {allDone ? (
            <div className="p-5 text-center">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent">
                <CheckIcon className="h-5 w-5 text-accent-foreground" strokeWidth={2.6} />
              </div>
              <h3 className="text-[15px] font-bold">Alt klart! 🎉</h3>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Du kan nå det viktigste i Proanbud. Resten oppdager du underveis.
              </p>
              <Button className="mt-3 w-full" onClick={() => finish("fullfort")}>
                Lukk
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  Kom i gang · {doneKeys.length} av {STEPS.length}
                </span>
                <button
                  type="button"
                  onClick={() => finish("avvist")}
                  className="-mr-1 rounded p-1 text-muted-foreground/70 hover:text-foreground"
                  aria-label="Skjul veiviseren"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mx-4 h-[3px] overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${Math.round((doneKeys.length / STEPS.length) * 100)}%` }}
                />
              </div>
              <ul className="m-1.5 mt-2">
                {STEPS.map((step) => {
                  const done = doneKeys.includes(step.key)
                  return (
                    <li key={step.key}>
                      <button
                        type="button"
                        disabled={done}
                        onClick={() => startStep(step)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] enabled:hover:bg-muted/60 disabled:cursor-default"
                      >
                        <span
                          className={cn(
                            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
                            done ? "border-accent bg-accent" : "border-border bg-background"
                          )}
                        >
                          {done && (
                            <CheckIcon className="h-3 w-3 text-accent-foreground" strokeWidth={3} />
                          )}
                        </span>
                        <span className={cn("flex-1", done && "text-muted-foreground/70 line-through")}>
                          {step.title}
                        </span>
                        {!done && (
                          <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground/80">
                            {isMobile ? "Åpne" : "Vis meg"}
                            <ArrowRightIcon className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
              <p className="px-4 pb-3 pt-0.5 text-[11.5px] text-muted-foreground/80">
                Ta stegene i den rekkefølgen du vil.
              </p>
            </>
          )}
        </div>
      )}

      {phase === "spot" && spot && (
        <>
          <svg
            className="fixed inset-0 z-[94] h-full w-full"
            style={{ pointerEvents: "none" }}
            aria-hidden="true"
          >
            {/* evenodd: første subpath = hele viewporten, andre = hullet.
                pointer-events kun på pathen — klikk i hullet går til appen. */}
            <path
              ref={maskPathRef}
              fillRule="evenodd"
              className="fill-foreground/55"
              style={{ pointerEvents: "auto" }}
              onClick={shakeTip}
              d=""
            />
          </svg>
          <div
            ref={ringRef}
            className="pointer-events-none fixed z-[94] rounded-lg border-2 border-primary"
            style={{ opacity: 0 }}
          >
            <span
              className="absolute -inset-[3px] rounded-lg border-2 border-accent motion-reduce:hidden"
              style={{ animation: "pa-tour-pulse 1.6s ease-out infinite" }}
              aria-hidden="true"
            />
          </div>
          <div
            ref={tipRef}
            className="fixed z-[95] w-[280px] rounded-lg border border-border bg-popover p-4 shadow-2xl"
            style={{ opacity: 0 }}
            role="dialog"
            aria-live="polite"
          >
            <div
              ref={arrowRef}
              className="absolute -left-[6px] h-3 w-3 rotate-45 border-b border-l border-border bg-popover"
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={backToPanel}
              className="absolute right-2 top-2 rounded p-1 text-muted-foreground/70 hover:text-foreground"
              aria-label="Avbryt"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {spot.step.title}
            </p>
            <h3 className="mt-1.5 text-sm font-bold">
              Klikk på «{spot.step.stages[spot.stage].clickLabel}»
            </h3>
            <p className="mt-1 text-[12.5px] text-muted-foreground">{spot.step.body}</p>
            <div className="mt-3 border-t border-border/70 pt-2.5">
              <button
                type="button"
                onClick={backToPanel}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Tilbake til listen
              </button>
            </div>
          </div>
        </>
      )}
    </>,
    document.body
  )
}
