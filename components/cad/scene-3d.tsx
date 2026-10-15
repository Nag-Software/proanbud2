"use client"

/**
 * 3D-visningen.
 *
 * Bygger på react-three-fiber (three.js). Bevisste valg:
 *  - INGEN eksterne assets: ingen HDRI fra CDN, ingen fontfiler. Lyssettingen
 *    er håndsatt (retningslys med myke skygger + himmel/bakke-lys), slik at
 *    scenen laster øyeblikkelig, virker offline og ikke brytes av CSP.
 *  - Geometrien kommer fra den samme `buildStoreySolids` som IFC-eksporten.
 *    Det brukeren ser er det mottakeren får.
 *  - Du kan dra en vegg rett i 3D: den glir langs sin egen normal, med
 *    rutenettsnapp, akkurat som i plantegningen.
 *  - Importerte filer vises som eget lag (scene-import.tsx), og alt kan måles
 *    med to trykk (scene-maling.tsx).
 *
 * Ytelse (telefon på byggeplassen):
 *  - Scenen tegnes bare når noe endrer seg (frameloop="demand"), ikke 60
 *    ganger i sekundet mens den står stille.
 *  - Skyggekartet og kontaktskyggen regnes ut når modellen endres, ikke når
 *    kameraet flyttes (lyset står fast i verden).
 *  - Dører og vinduer er slått sammen til få mesher, og glasset er vanlig
 *    gjennomsiktig materiale (transmisjon krever et eget tegnepass).
 *  - Store importerte modeller får lavere oppløsning MENS man snur dem, og
 *    trykk testes mot et BVH-tre i stedet for hver trekant.
 */

import * as React from "react"
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber"
import { AdaptiveDpr, Bvh, ContactShadows, Edges, Grid, OrbitControls } from "@react-three/drei"
import { Maximize, MousePointer2, Ruler, Trash2 } from "lucide-react"
import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"

import { ImportertModell, ImportertTegning } from "@/components/cad/scene-import"
import {
  ElementKort,
  ImportElementKort,
  MalingKort,
  MalingLag,
  Plukker,
  VeggMal3D,
  type PlukkFn,
} from "@/components/cad/scene-maling"
import { buildStoreySolids, modelBounds, pointOnWall, worldFromPlan } from "@/lib/cad/geometry"
import { useCadImportAdapter, useLastedeImporter } from "@/lib/cad/import/use-import"
import type { LastetModell } from "@/lib/cad/import/last-modell"
import type { LastetTegning } from "@/lib/cad/import/last-tegning"
import { tilPlanPunkt, type Snapp } from "@/lib/cad/maling"
import { normalize, perpendicular, sub } from "@/lib/cad/math"
import { ELEMENT_COLORS } from "@/lib/cad/presets"
import type { CadStore } from "@/lib/cad/store"
import { useCadState } from "@/lib/cad/store"
import type { BuildingModel, ElementSolid, ModelImport, SelectionRef, Storey } from "@/lib/cad/types"
import { cn } from "@/lib/utils"

type SolidEntry = { storey: Storey; solid: ElementSolid }
type Modus = "velg" | "mal"
type LastetModellLag = { entry: ModelImport; modell: LastetModell }
type LastetTegningLag = { entry: ModelImport; tegning: LastetTegning }

/** Over dette regnes en importert modell som tung (lavere oppløsning mens man snur). */
const TUNG_MODELL_TREKANTER = 400_000

export function Scene3D({
  store,
  className,
  canEdit = true,
  visElementKort = false,
}: {
  store: CadStore
  className?: string
  /** Uten redigering kan delene velges og måles, men ikke dras. */
  canEdit?: boolean
  /** Vis mål på valgt vegg/dør/dekke i et kort (når egenskapspanelet ikke vises). */
  visElementKort?: boolean
}) {
  const state = useCadState(store)

  /**
   * Startkameraet regnes ÉN gang.
   *
   * Tidligere fulgte både kameraposisjonen og OrbitControls-målet modellens
   * bounds, som regnes på nytt ved hver eneste endring. En rotasjon flyttet
   * dermed både mål og kamera midt i bevegelsen, og bygget forsvant ut av
   * bildet. Nå eier brukeren kameraet; «Sentrer» rammer inn på kommando.
   */
  const [initialView] = React.useState<{
    position: [number, number, number]
    target: [number, number, number]
  }>(() => {
    const bounds = modelBounds(state.model)
    const radius = Math.max(bounds.width, bounds.height, 8)
    return {
      position: [bounds.center.x + radius * 0.9, radius * 0.8, -bounds.center.y + radius * 1.1],
      target: [bounds.center.x, 1.2, -bounds.center.y],
    }
  })

  const fitViewRef = React.useRef<(() => void) | null>(null)
  const plukkRef = React.useRef<PlukkFn | null>(null)

  // Hjelpeteksten er skrevet for det brukeren faktisk har i hånda (mus eller
  // finger), og forsvinner så snart hen har tatt tak i modellen.
  const [coarsePointer, setCoarsePointer] = React.useState(false)
  const [interacted, setInteracted] = React.useState(false)
  React.useEffect(() => {
    setCoarsePointer(window.matchMedia("(pointer: coarse)").matches)
  }, [])

  // --- Importerte filer ---------------------------------------------------------
  const adapter = useCadImportAdapter()
  const synligeImporter = React.useMemo(
    () => (state.model.imports ?? []).filter((entry) => entry.visible),
    [state.model.imports]
  )
  const lastet = useLastedeImporter(synligeImporter, adapter)
  const importNokkel = lastet.map(({ entry, status }) => `${entry.id}:${status?.status ?? "-"}`).join("|")
  const { modeller, tegninger, laster, trekanter } = React.useMemo(() => {
    const modeller: LastetModellLag[] = []
    const tegninger: LastetTegningLag[] = []
    let laster = 0
    let trekanter = 0
    for (const { entry, status } of lastet) {
      if (!status || status.status === "laster") laster++
      if (status?.status !== "klar") continue
      if (status.modell) {
        modeller.push({ entry, modell: status.modell })
        trekanter += status.modell.geometri.trekanter
      }
      if (status.tegning) tegninger.push({ entry, tegning: status.tegning })
    }
    return { modeller, tegninger, laster, trekanter }
    // `lastet` er en ny liste hver gang; innholdet endres bare med nøkkelen og modellen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importNokkel, state.model.imports])
  const tung = trekanter > TUNG_MODELL_TREKANTER

  // --- Velg og mål ---------------------------------------------------------------
  const [modus, setModus] = React.useState<Modus>("velg")
  const [malStart, setMalStart] = React.useState<Snapp | null>(null)
  const [peker, setPeker] = React.useState<Snapp | null>(null)
  const [valgtMaling, setValgtMaling] = React.useState<string | null>(null)
  const [importInfo, setImportInfo] = React.useState<{ importId: string; element: number } | null>(null)
  // BVH-treet for importerte modeller bygges først når noen trykker eller måler.
  const [bvhPa, setBvhPa] = React.useState(false)

  const byttModus = (neste: Modus) => {
    setModus(neste)
    setMalStart(null)
    setPeker(null)
    setValgtMaling(null)
    if (neste === "mal") {
      setImportInfo(null)
      store.setSelection(null)
      if (modeller.length > 0) setBvhPa(true)
    }
  }

  const malinger = state.model.measurements ?? []
  const valgtMalingData = malinger.find((item) => item.id === valgtMaling) ?? null

  const trykk = React.useRef<{ id: number; x: number; y: number; tid: number } | null>(null)
  const pekerRamme = React.useRef<number | null>(null)

  const handleTrykk = (event: React.PointerEvent) => {
    const grense = event.pointerType === "mouse" ? 10 : 22
    const resultat = plukkRef.current?.(event.clientX, event.clientY, grense) ?? null
    if (!bvhPa && modeller.length > 0) setBvhPa(true)

    if (modus === "mal") {
      if (!resultat) return
      if (!malStart) {
        setMalStart(resultat)
        return
      }
      const id = store.addMeasurement(tilPlanPunkt(malStart.punkt), tilPlanPunkt(resultat.punkt))
      setMalStart(null)
      setPeker(null)
      setValgtMaling(id)
      return
    }

    setValgtMaling(null)
    if (resultat?.importTreff) {
      setImportInfo(resultat.importTreff)
      store.setSelection(null)
    } else {
      setImportInfo(null)
    }
  }

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || modus !== "mal") return
      if (malStart) setMalStart(null)
      else setModus("velg")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [malStart, modus])

  React.useEffect(
    () => () => {
      if (pekerRamme.current !== null) cancelAnimationFrame(pekerRamme.current)
    },
    []
  )

  const importInfoData = importInfo ? modeller.find((item) => item.entry.id === importInfo.importId) : undefined
  const valgtStorey = state.selection
    ? state.model.storeys.find((storey) => storey.id === state.selection?.storeyId)
    : undefined

  const kort = valgtMalingData ? (
    <MalingKort
      maling={valgtMalingData}
      onLukk={() => setValgtMaling(null)}
      onSlett={() => {
        store.removeMeasurement(valgtMalingData.id)
        setValgtMaling(null)
      }}
    />
  ) : importInfo && importInfoData ? (
    <ImportElementKort
      entry={importInfoData.entry}
      geometri={importInfoData.modell.geometri}
      element={importInfo.element}
      hentInfo={importInfoData.modell.hentInfo}
      onLukk={() => setImportInfo(null)}
    />
  ) : visElementKort && modus === "velg" && state.selection && valgtStorey ? (
    <ElementKort selection={state.selection} storey={valgtStorey} onLukk={() => store.setSelection(null)} />
  ) : null

  const hint =
    modus === "mal"
      ? malStart
        ? "Trykk på det andre punktet"
        : coarsePointer
          ? "Trykk på første punkt · hjørner og kanter fester seg"
          : "Klikk på første punkt · hjørner og kanter fester seg"
      : interacted
        ? null
        : coarsePointer
          ? "Dra med én finger for å snu · to fingre for å zoome og flytte"
          : "Dra for å snu · rull for å zoome · høyreklikk og dra for å flytte"

  return (
    <div
      // `isolate`: etikettene i scenen (mål) skal ikke legge seg over panelet.
      className={cn("@container relative isolate h-full w-full bg-gradient-to-b from-sky-50 to-slate-100 dark:from-slate-900 dark:to-slate-950", className)}
      onPointerDownCapture={(event) => {
        setInteracted(true)
        if ((event.target as HTMLElement).tagName !== "CANVAS") return
        trykk.current = { id: event.pointerId, x: event.clientX, y: event.clientY, tid: performance.now() }
      }}
      onPointerUpCapture={(event) => {
        const start = trykk.current
        trykk.current = null
        if (!start || start.id !== event.pointerId) return
        if ((event.target as HTMLElement).tagName !== "CANVAS") return
        // Et trykk, ikke et drag for å snu modellen.
        const flyttet = Math.hypot(event.clientX - start.x, event.clientY - start.y)
        if (flyttet > (event.pointerType === "mouse" ? 5 : 10) || performance.now() - start.tid > 700) return
        handleTrykk(event)
      }}
      onPointerMove={(event) => {
        if (modus !== "mal" || event.pointerType !== "mouse" || event.buttons !== 0) return
        if ((event.target as HTMLElement).tagName !== "CANVAS") return
        if (pekerRamme.current !== null) return
        const { clientX, clientY } = event
        pekerRamme.current = requestAnimationFrame(() => {
          pekerRamme.current = null
          setPeker(plukkRef.current?.(clientX, clientY, 10) ?? null)
        })
      }}
      onPointerLeave={() => setPeker(null)}
      onWheelCapture={() => setInteracted(true)}
    >
      <Canvas
        // Tegn bare når noe endrer seg. OrbitControls, r3f-props og etikettene
        // ber selv om nytt bilde.
        frameloop="demand"
        // VSM er den eneste skyggetypen i three 0.185 som gir ekte myk kant
        // (shadow-radius). drei sin SoftShadows kan IKKE brukes her: den
        // patcher inn `unpackRGBAToDepth`, som er fjernet i denne versjonen, og
        // da feiler alle MeshStandardMaterial å kompilere — modellen blir stående
        // som ren trådramme.
        shadows="variance"
        dpr={[1, 2]}
        performance={{ min: 0.5 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          powerPreference: "high-performance",
        }}
        camera={{
          position: initialView.position,
          fov: 45,
          near: 0.05,
          // Fast, romslig klippeplan i stedet for et som skalerer med modellen —
          // da slipper vi at kameraet må røres når bygget vokser.
          far: 4000,
        }}
        onPointerMissed={() => {
          if (modus === "velg") store.setSelection(null)
        }}
      >
        <SceneContents
          store={store}
          initialTarget={initialView.target}
          fitViewRef={fitViewRef}
          plukkRef={plukkRef}
          modus={modus}
          canEdit={canEdit}
          lettSkygge={coarsePointer}
          tung={tung}
          bvhPa={bvhPa}
          modeller={modeller}
          tegninger={tegninger}
          markert={importInfo}
          malStart={malStart}
          peker={peker}
          valgtMaling={valgtMaling}
          onVelgMaling={(id) => {
            setValgtMaling(id)
            setImportInfo(null)
          }}
        />
      </Canvas>

      {hint && (
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 top-3 z-30 max-w-[calc(100%-1.5rem)] -translate-x-1/2 truncate rounded-full border bg-background/90 px-3 py-1 text-[11px] font-medium shadow-sm backdrop-blur",
            modus === "mal" ? "border-sky-500/50 text-foreground" : "text-muted-foreground"
          )}
        >
          {hint}
        </div>
      )}

      {laster > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 z-30 rounded-full border bg-background/90 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          Laster {laster === 1 ? "fil" : `${laster} filer`} …
        </div>
      )}

      {/* Over etikettene i scenen (z-index opptil 20, se scene-maling.tsx). */}
      {kort && <div className="absolute inset-x-2 bottom-16 z-30 @md:inset-x-auto @md:left-3 @md:w-80">{kort}</div>}

      {/* Bunnlinja: store mål for fingre. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex items-center justify-between gap-2 px-3">
        <button
          type="button"
          onClick={() => fitViewRef.current?.()}
          className="pointer-events-auto inline-flex h-10 items-center gap-1.5 rounded-full border bg-background/95 px-3 text-xs font-medium shadow-sm backdrop-blur hover:bg-accent"
          aria-label="Vis hele bygget"
        >
          <Maximize className="size-4" />
          <span className="hidden whitespace-nowrap @lg:inline">Vis hele bygget</span>
        </button>

        <div
          className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-background/95 p-1 shadow-sm backdrop-blur"
          role="group"
          aria-label="Verktøy i 3D"
        >
          <button
            type="button"
            aria-pressed={modus === "velg"}
            onClick={() => byttModus("velg")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
              modus === "velg" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <MousePointer2 className="size-3.5" />
            Velg
          </button>
          <button
            type="button"
            aria-pressed={modus === "mal"}
            onClick={() => byttModus(modus === "mal" ? "velg" : "mal")}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
              modus === "mal" ? "bg-sky-600 text-white" : "text-muted-foreground hover:bg-accent"
            )}
          >
            <Ruler className="size-3.5" />
            Mål
          </button>
        </div>

        {malinger.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              store.clearMeasurements()
              setValgtMaling(null)
            }}
            className="pointer-events-auto inline-flex h-10 items-center gap-1.5 rounded-full border bg-background/95 px-3 text-xs font-medium shadow-sm backdrop-blur hover:bg-accent"
            aria-label="Fjern alle mål"
          >
            <Trash2 className="size-4" />
            <span className="hidden whitespace-nowrap @lg:inline">Fjern mål</span>
          </button>
        ) : (
          <span className="w-10" aria-hidden />
        )}
      </div>
    </div>
  )
}

function SceneContents({
  store,
  initialTarget,
  fitViewRef,
  plukkRef,
  modus,
  canEdit,
  lettSkygge,
  tung,
  bvhPa,
  modeller,
  tegninger,
  markert,
  malStart,
  peker,
  valgtMaling,
  onVelgMaling,
}: {
  store: CadStore
  initialTarget: [number, number, number]
  fitViewRef: React.RefObject<(() => void) | null>
  plukkRef: React.RefObject<PlukkFn | null>
  modus: Modus
  canEdit: boolean
  /** Telefon/nettbrett: mindre skyggekart. */
  lettSkygge: boolean
  tung: boolean
  bvhPa: boolean
  modeller: LastetModellLag[]
  tegninger: LastetTegningLag[]
  markert: { importId: string; element: number } | null
  malStart: Snapp | null
  peker: Snapp | null
  valgtMaling: string | null
  onVelgMaling: (id: string) => void
}) {
  const state = useCadState(store)
  const { camera } = useThree()
  const bounds = React.useMemo(() => modelBounds(state.model), [state.model])
  const controlsRef = React.useRef<{ target: THREE.Vector3; update: () => void } | null>(null)

  /**
   * Rutenett, skyggekamera og lys holdes på en FAST skala.
   *
   * Lot vi dem følge modellens bounds, ble hele rutenettet og skyggekartet
   * bygget om for hver minste endring — synlig blafring mens man drar i en
   * vegg. En romslig fast skala dekker et vanlig småhusprosjekt uten å røre
   * seg.
   */
  const [radius] = React.useState(() => {
    const bounds = modelBounds(state.model)
    return Math.max(bounds.width, bounds.height, 30)
  })

  const size = useThree((three) => three.size)
  const invalidate = useThree((three) => three.invalidate)
  const buildingRef = React.useRef<THREE.Group>(null)
  const importRef = React.useRef<THREE.Group>(null)
  const [plukkGrupper] = React.useState(() => [buildingRef, importRef])
  // Har brukeren selv flyttet kameraet, står det stille — da skal verken en ny
  // vegg eller et fullskjermbytte rive bildet ut av hendene på hen.
  const userMovedRef = React.useRef(false)

  /**
   * Rammer inn HELE bygget: målt fra det som faktisk tegnes (vegger, dekker,
   * takets møne og importerte modeller), og tilpasset bildeformatet, så bygget
   * også får plass i en smal, høy visning. Effekten bytter bare ut en closure
   * når modellen endrer seg — den rører aldri kameraet av seg selv.
   */
  React.useEffect(() => {
    fitViewRef.current = () => {
      const box = new THREE.Box3()
      if (buildingRef.current) box.setFromObject(buildingRef.current)
      if (importRef.current) box.union(new THREE.Box3().setFromObject(importRef.current))
      if (box.isEmpty()) {
        const current = modelBounds(state.model)
        const span = Math.max(current.width, current.height, 8)
        box.set(
          new THREE.Vector3(current.center.x - span / 2, 0, -current.center.y - span / 2),
          new THREE.Vector3(current.center.x + span / 2, 3, -current.center.y + span / 2)
        )
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      const radius = Math.max(sphere.radius, 3)
      const perspective = camera as THREE.PerspectiveCamera
      const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : perspective.aspect
      const verticalFov = THREE.MathUtils.degToRad(perspective.fov)
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect)
      const distance = (radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * 1.05
      // Et trekvart-blikk litt ovenfra: viser to fasader og taket samtidig.
      const direction = new THREE.Vector3(0.9, 0.6, 1.1).normalize()
      camera.position.copy(sphere.center).addScaledVector(direction, distance)
      // Store importerte modeller (tomt, terreng) må ikke klippes bort.
      if (perspective.far < distance * 4) {
        perspective.far = distance * 4
      }
      const controls = controlsRef.current
      if (controls) {
        controls.target.copy(sphere.center)
        controls.update()
      }
      camera.updateProjectionMatrix()
      userMovedRef.current = false
      invalidate()
    }
    return () => {
      fitViewRef.current = null
    }
  }, [camera, fitViewRef, invalidate, size.height, size.width, state.model])

  /**
   * Ramm inn automatisk så lenge brukeren ikke har tatt kameraet selv: når
   * visningen får sin størrelse (første gang, bytte mellom 3D og delt
   * visning, fullskjerm), første gang en tom etasje får geometri, og når en
   * importert modell er ferdig lastet.
   */
  const hasGeometry = React.useMemo(
    () =>
      state.model.storeys.some(
        (storey) =>
          storey.walls.length > 0 || storey.slabs.length > 0 || storey.roofs.length > 0
      ),
    [state.model]
  )
  const wasEmpty = React.useRef(!hasGeometry)
  React.useEffect(() => {
    if (size.width === 0 || size.height === 0) return
    if (!userMovedRef.current) fitViewRef.current?.()
  }, [fitViewRef, size.height, size.width])
  React.useEffect(() => {
    if (wasEmpty.current && hasGeometry) fitViewRef.current?.()
    wasEmpty.current = !hasGeometry
  }, [fitViewRef, hasGeometry])
  const antallModeller = modeller.length
  const forrigeAntallModeller = React.useRef(antallModeller)
  React.useEffect(() => {
    if (antallModeller > forrigeAntallModeller.current && !userMovedRef.current) fitViewRef.current?.()
    forrigeAntallModeller.current = antallModeller
  }, [antallModeller, fitViewRef])

  const visibleStoreys = React.useMemo(
    () =>
      state.showAllStoreys
        ? state.model.storeys
        : state.model.storeys.filter((storey) => storey.id === state.activeStoreyId),
    [state.activeStoreyId, state.model.storeys, state.showAllStoreys]
  )

  // Mens en vegg dras må kamerastyringen stå stille, ellers roterer scenen
  // samtidig. Vi styrer det med React-state og `enabled`-propen i stedet for å
  // skru på controls-objektet direkte — det er objektet r3f eier.
  const [draggingWall, setDraggingWall] = React.useState(false)

  const entries = React.useMemo<SolidEntry[]>(() => {
    const result: SolidEntry[] = []
    for (const storey of visibleStoreys) {
      for (const solid of buildStoreySolids(storey).solids) {
        result.push({ storey, solid })
      }
    }
    return result
  }, [visibleStoreys])

  const forsteEtasje = state.model.storeys[0]?.id
  const synligeTegninger = tegninger.flatMap(({ entry, tegning }) => {
    const storey = visibleStoreys.find((item) => item.id === (entry.storeyId ?? forsteEtasje))
    return storey ? [{ entry, tegning, hoyde: storey.elevation }] : []
  })

  // Skyggene regnes på nytt bare når det som kaster dem endrer seg.
  const modellNokkel = modeller.map(({ entry }) => entry.id).join("|")
  const skyggeNokkel = React.useMemo(
    () => ({}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, modeller]
  )
  const [kontaktNokkel, setKontaktNokkel] = React.useState(0)
  React.useEffect(() => {
    // Kontaktskyggen tegnes én gang per endring; under et drag venter vi til slipp.
    if (draggingWall) return
    const timer = window.setTimeout(() => setKontaktNokkel((n) => n + 1), 120)
    return () => window.clearTimeout(timer)
  }, [draggingWall, skyggeNokkel])

  const interaktiv = modus === "velg"
  const shadowMap = lettSkygge ? 1024 : 2048

  return (
    <>
      <color attach="background" args={["#e9eef5"]} />
      <fog attach="fog" args={["#e9eef5", radius * 3, radius * 9]} />

      <Plukker plukkRef={plukkRef} grupper={plukkGrupper} />
      <SkyggeOppdatering nokkel={skyggeNokkel} />
      {tung && <AdaptiveDpr />}

      {/* Himmel- og bakkelys gir farget omgivelseslys: kjølig ovenfra, varmt
          reflektert nedenfra, slik dagslys faktisk oppfører seg. */}
      <hemisphereLight args={["#cfe3ff", "#c9bda8", 1.25]} />
      <directionalLight
        castShadow
        position={[radius * 0.7, radius * 1.3, radius * 0.55]}
        intensity={2.4}
        shadow-mapSize={[shadowMap, shadowMap]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-radius={lettSkygge ? 4 : 6}
        shadow-blurSamples={lettSkygge ? 8 : 16}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-radius * 1.2, radius * 1.2, radius * 1.2, -radius * 1.2, 0.1, radius * 6]}
        />
      </directionalLight>
      {/* Utfyllingslys fra motsatt side, så skyggesidene ikke blir døde. */}
      <directionalLight position={[-radius, radius * 0.5, -radius * 0.8]} intensity={0.45} />
      {/* Svakt motlys som tegner opp kantene mot bakgrunnen. */}
      <directionalLight position={[0, radius * 0.3, -radius * 1.4]} intensity={0.25} />

      {/* Bakkeplan som tar imot skygge. Uten det henger bygget i løse lufta. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[initialTarget[0], -0.02, initialTarget[2]]}
        receiveShadow
      >
        <planeGeometry args={[radius * 8, radius * 8]} />
        <meshStandardMaterial color="#dfe4ea" roughness={1} metalness={0} />
      </mesh>

      <Grid
        position={[initialTarget[0], -0.01, initialTarget[2]]}
        args={[radius * 4, radius * 4]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#c3cbd6"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#93a1b3"
        fadeDistance={radius * 6}
        fadeStrength={1}
        infiniteGrid={false}
        followCamera={false}
      />

      {/* Tegnes én gang per endring (frames=1), ikke for hvert bilde. */}
      <ContactShadows
        key={kontaktNokkel}
        frames={1}
        position={[bounds.center.x, 0.001, -bounds.center.y]}
        scale={radius * 3}
        opacity={0.35}
        blur={2.2}
        far={radius}
        resolution={lettSkygge ? 256 : 512}
      />

      <group ref={buildingRef}>
        {entries.map(({ storey, solid }) => (
          <SolidMeshView
            key={`${storey.id}:${solid.id}`}
            store={store}
            storey={storey}
            solid={solid}
            model={state.model}
            selection={state.selection}
            interaktiv={interaktiv}
            kanDra={canEdit}
            onDragChange={setDraggingWall}
          />
        ))}
      </group>

      <Bvh key={modellNokkel} enabled={bvhPa} firstHitOnly>
        <group ref={importRef}>
          {modeller.map(({ entry, modell }) => (
            <ImportertModell
              key={entry.id}
              entry={entry}
              geometri={modell.geometri}
              markert={markert?.importId === entry.id ? markert.element : null}
            />
          ))}
        </group>
      </Bvh>

      {synligeTegninger.map(({ entry, tegning, hoyde }) => (
        <ImportertTegning key={entry.id} entry={entry} tegning={tegning} hoyde={hoyde} />
      ))}

      {state.showDimensions && <VeggMal3D storeys={visibleStoreys} />}

      <MalingLag
        malinger={state.model.measurements ?? []}
        valgt={valgtMaling}
        onVelg={onVelgMaling}
        start={malStart}
        peker={modus === "mal" ? peker : null}
      />

      <OrbitControls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={controlsRef as any}
        makeDefault
        enabled={!draggingWall}
        regress={tung}
        onStart={() => {
          userMovedRef.current = true
        }}
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.05}
        // `target` settes kun ved montering. Som prop ville den blitt skrevet
        // tilbake ved hver render og overstyrt brukerens egen panorering.
        target={initialTarget}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
      />
    </>
  )
}

/**
 * Skyggekartet tegnes bare når geometrien endres. Lyset står fast i verden,
 * så å snu kameraet endrer ingen skygger — uten dette ble kartet (2048², VSM
 * med uskarphet) tegnet på nytt for hvert eneste bilde.
 */
function SkyggeOppdatering({ nokkel }: { nokkel: unknown }) {
  // Rendereren hentes via `get()`: den eies av r3f, ikke av denne komponenten.
  const get = useThree((three) => three.get)
  React.useEffect(() => {
    const skygger = get().gl.shadowMap
    skygger.autoUpdate = false
    return () => {
      skygger.autoUpdate = true
    }
  }, [get])
  React.useEffect(() => {
    get().gl.shadowMap.needsUpdate = true
    get().invalidate()
  }, [get, nokkel])
  return null
}

const SolidMeshView = React.memo(function SolidMeshView({
  store,
  storey,
  solid,
  model,
  selection,
  interaktiv,
  kanDra,
  onDragChange,
}: {
  store: CadStore
  storey: Storey
  solid: ElementSolid
  model: BuildingModel
  selection: SelectionRef | null
  /** Av i målemodus: da hører trykk til målingen, ikke valg og drag. */
  interaktiv: boolean
  kanDra: boolean
  onDragChange: (dragging: boolean) => void
}) {
  const { camera, raycaster, gl } = useThree()
  const [hovered, setHovered] = React.useState(false)
  const opening =
    solid.elementKind === "opening"
      ? storey.walls.flatMap((wall) => wall.openings).find((candidate) => candidate.id === solid.elementId)
      : undefined

  const geometry = React.useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(solid.mesh.positions, 3))
    buffer.setIndex(solid.mesh.indices)
    buffer.computeVertexNormals()
    return buffer
  }, [solid.mesh])

  React.useEffect(() => () => geometry.dispose(), [geometry])

  const appearance = React.useMemo(
    () => resolveAppearance(solid, storey, model),
    [model, solid, storey]
  )

  const isSelected =
    selection?.kind === appearanceKind(solid) && selection.id === solid.elementId

  const wall =
    solid.elementKind === "wall"
      ? storey.walls.find((item) => item.id === solid.elementId)
      : undefined

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation()

    const selectionRef = selectionFor(solid, storey)
    if (selectionRef) store.setSelection(selectionRef)

    if (!kanDra || !wall || wall.locked || event.button !== 0) return

    // Dra i veggen: vi projiserer musa på et vannrett plan i veggens høyde og
    // lar bare bevegelsen LANGS veggnormalen telle. Da glir veggen sidelengs i
    // stedet for å bli slengt ut i rommet.
    const direction = normalize(sub(wall.b, wall.a))
    const wallNormal = new THREE.Vector2(
      perpendicular(direction).x,
      perpendicular(direction).y
    )
    const planeHeight = storey.elevation + wall.baseOffset + wall.height / 2
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight)
    const previous = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(plane, previous)) return

    // OrbitControls lytter på canvas-elementet direkte, så r3f-ens
    // stopPropagation stopper den ikke. Uten dette ville kameraet rotert
    // samtidig som veggen flyttes.
    onDragChange(true)

    const canvas = gl.domElement

    const onMove = (moveEvent: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((moveEvent.clientX - rect.left) / rect.width) * 2 - 1,
        -((moveEvent.clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(pointer, camera)
      const current = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(plane, current)) return

      // three-akser tilbake til planet: x = x, y = -z
      const deltaPlan = new THREE.Vector2(current.x - previous.x, -(current.z - previous.z))
      const along = deltaPlan.dot(wallNormal)
      const gridSize = model.meta.gridSize || 0.1
      const snapped = Math.round(along / gridSize) * gridSize
      if (Math.abs(snapped) < 1e-9) return

      store.moveWall(
        wall.id,
        { x: wallNormal.x * snapped, y: wallNormal.y * snapped },
        { transient: true }
      )
      previous.copy(current)
    }

    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      onDragChange(false)
      store.commitTransient()
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  // Uten hendelser er meshen usynlig for r3f sin plukking: i målemodus
  // slipper den da å testes ved hver musebevegelse.
  const handlers = interaktiv
    ? {
        onPointerDown: handlePointerDown,
        onPointerOver: (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation()
          setHovered(true)
        },
        onPointerOut: () => setHovered(false),
      }
    : {}
  const visHover = hovered && interaktiv

  if (solid.elementKind === "opening" && wall && opening) {
    return (
      <OpeningVisual
        geometry={geometry}
        wall={wall}
        opening={opening}
        storey={storey}
        isSelected={isSelected}
        hovered={visHover}
        handlers={handlers}
        materialColor={
          solid.materialId
            ? model.materials.find((item) => item.id === solid.materialId)?.color ?? null
            : null
        }
      />
    )
  }

  return (
    <mesh geometry={geometry} castShadow={appearance.castShadow} receiveShadow {...handlers}>
      <meshStandardMaterial
        color={isSelected ? ELEMENT_COLORS.selection : visHover ? ELEMENT_COLORS.hover : appearance.color}
        roughness={appearance.roughness}
        metalness={0.02}
        side={THREE.FrontSide}
        emissive={isSelected ? ELEMENT_COLORS.selection : "#000000"}
        emissiveIntensity={isSelected ? 0.18 : 0}
        transparent={appearance.transparent}
        opacity={appearance.transparent ? 0.2 : 1}
        depthWrite={!appearance.transparent}
      />
      {/* Mørk, tynn kantlinje langs de EKTE hjørnene (threshold filtrerer bort
          trekantkanter inne i flatene). Det er dette som får volumene til å
          leses som bygningsdeler i stedet for grå klumper. */}
      <Edges
        color={isSelected ? ELEMENT_COLORS.selection : "#4a5058"}
        threshold={18}
        scale={1.0008}
        userData={{ ignorer: true }}
      />
    </mesh>
  )
})

function OpeningVisual({
  geometry,
  wall,
  opening,
  storey,
  isSelected,
  hovered,
  handlers,
  materialColor,
}: {
  geometry: THREE.BufferGeometry
  wall: Storey["walls"][number]
  opening: Storey["walls"][number]["openings"][number]
  storey: Storey
  isSelected: boolean
  hovered: boolean
  handlers: Partial<Record<"onPointerDown" | "onPointerOver" | "onPointerOut", (event: ThreeEvent<PointerEvent>) => void>>
  /** Fargen på varen som er lagt på åpningen, eller null når ingen er valgt. */
  materialColor: string | null
}) {
  /**
   * Karm, ramme og vannbrett slås sammen til ÉN geometri, glass og dørblad er
   * egne. Før var hver bit en egen mesh med egen kantlinje — rundt 20
   * tegnekall per vindu.
   */
  const { karm, glass, blad } = React.useMemo(() => {
    const localDirection = normalize(sub(wall.b, wall.a))
    const worldDirection = new THREE.Vector3(localDirection.x, 0, -localDirection.y).normalize()
    const worldUp = new THREE.Vector3(0, 1, 0)
    const worldNormal = new THREE.Vector3().crossVectors(worldDirection, worldUp).normalize()
    const basis = new THREE.Matrix4().makeBasis(worldDirection, worldUp, worldNormal)
    const center = new THREE.Vector3(
      ...worldFromPlan(
        pointOnWall(wall, opening.distance),
        storey.elevation + wall.baseOffset + opening.sill + opening.height / 2
      )
    )
    basis.setPosition(center)

    const box = (
      width: number,
      height: number,
      depth: number,
      offsetX = 0,
      offsetY = 0,
      offsetZ = 0
    ): THREE.BufferGeometry | null => {
      if (width <= 0 || height <= 0 || depth <= 0) return null
      const geometri = new THREE.BoxGeometry(width, height, depth)
      geometri.translate(offsetX, offsetY, offsetZ)
      geometri.applyMatrix4(basis)
      return geometri
    }

    const isWindow = opening.kind !== "door"
    const frameDepth = Math.min(Math.max(wall.thickness * 0.28, 0.06), 0.1)
    const sideFrame = Math.min(Math.max(opening.width * 0.08, 0.045), 0.08)
    const topFrame = Math.min(Math.max(opening.height * 0.08, 0.045), 0.08)
    const bottomFrame = isWindow ? Math.min(Math.max(opening.height * 0.06, 0.035), 0.06) : 0.03
    const innerWidth = Math.max(opening.width - sideFrame * 2, 0.02)
    const innerHeight = Math.max(opening.height - topFrame - bottomFrame, 0.02)
    const outerFaceZ = wall.thickness / 2 - frameDepth / 2
    const innerFaceZ = -wall.thickness / 2 + frameDepth / 2

    // Ytre og indre ramme gir dybde og skygger som leses bedre i 3D enn en flat boks.
    const rammer: Array<THREE.BufferGeometry | null> = []
    for (const faceZ of [outerFaceZ, innerFaceZ]) {
      rammer.push(box(sideFrame, opening.height, frameDepth, -opening.width / 2 + sideFrame / 2, 0, faceZ))
      rammer.push(box(sideFrame, opening.height, frameDepth, opening.width / 2 - sideFrame / 2, 0, faceZ))
      rammer.push(box(innerWidth, topFrame, frameDepth, 0, opening.height / 2 - topFrame / 2, faceZ))
      if (bottomFrame > 0) {
        rammer.push(box(innerWidth, bottomFrame, frameDepth, 0, -opening.height / 2 + bottomFrame / 2, faceZ))
      }
    }

    let glass: THREE.BufferGeometry | null = null
    let blad: THREE.BufferGeometry | null = null
    if (isWindow) {
      const glassDepth = Math.min(Math.max(wall.thickness * 0.08, 0.012), 0.03)
      glass = box(
        Math.max(innerWidth - 0.02, 0.01),
        Math.max(innerHeight - 0.02, 0.01),
        glassDepth,
        0,
        (bottomFrame - topFrame) * 0.05,
        0
      )
      // Vannbrett: en tynn, utstikkende hylle under vinduet. Liten detalj, men
      // det er slike kanter øyet bruker for å lese et vindu som et vindu.
      const sillDepth = wall.thickness * 0.5 + 0.04
      rammer.push(box(opening.width + 0.08, 0.03, sillDepth, 0, -opening.height / 2 + 0.015, outerFaceZ - sillDepth * 0.25))
    } else {
      const leafWidth = Math.max(opening.width - 0.06, 0.02)
      const leafHeight = Math.max(opening.height - 0.07, 0.02)
      const leafDepth = Math.min(Math.max(wall.thickness * 0.18, 0.04), 0.07)
      blad = box(leafWidth, leafHeight, leafDepth, 0, -0.01, 0)
    }

    const deler = rammer.filter((item): item is THREE.BufferGeometry => item !== null)
    const karm = deler.length > 0 ? mergeGeometries(deler, false) : null
    for (const del of deler) del.dispose()
    return { karm, glass, blad }
  }, [opening, storey.elevation, wall])

  React.useEffect(
    () => () => {
      karm?.dispose()
      glass?.dispose()
      blad?.dispose()
    },
    [blad, glass, karm]
  )

  // Karmen tar fargen fra varen brukeren har valgt. Uten valgt vare bruker vi
  // hvit karm på vindu (norsk standard — glasset har sitt eget materiale) og
  // trefarge på dør.
  const isWindow = opening.kind !== "door"
  const frameColor = materialColor ?? (isWindow ? "#f4f3f0" : ELEMENT_COLORS.door)
  const fremhevet = isSelected ? ELEMENT_COLORS.selection : hovered ? ELEMENT_COLORS.hover : null

  return (
    <group {...handlers}>
      {/* Usynlig treffboks som fyller hullet, så åpningen er lett å treffe. */}
      <mesh geometry={geometry} visible={false} />

      {karm && (
        <mesh geometry={karm} castShadow receiveShadow>
          <meshStandardMaterial
            color={fremhevet ?? frameColor}
            roughness={0.72}
            metalness={0.01}
            emissive={isSelected ? ELEMENT_COLORS.selection : "#000000"}
            emissiveIntensity={isSelected ? 0.12 : 0}
          />
          <Edges color={isSelected ? ELEMENT_COLORS.selection : "#9aa0a6"} scale={1.001} userData={{ ignorer: true }} />
        </mesh>
      )}
      {blad && (
        <mesh geometry={blad} castShadow receiveShadow>
          <meshStandardMaterial color={fremhevet ?? frameColor} roughness={0.55} metalness={0.02} />
          <Edges color={isSelected ? ELEMENT_COLORS.selection : "#7a5a3a"} scale={1.001} userData={{ ignorer: true }} />
        </mesh>
      )}
      {glass && (
        <mesh geometry={glass} renderOrder={2}>
          <meshStandardMaterial
            color={isSelected ? ELEMENT_COLORS.selection : "#9cc8e0"}
            transparent
            opacity={0.38}
            roughness={0.05}
            metalness={0.1}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  )
}

function appearanceKind(solid: ElementSolid): SelectionRef["kind"] {
  return solid.elementKind === "space" ? "space" : solid.elementKind
}

function selectionFor(solid: ElementSolid, storey: Storey): SelectionRef | null {
  if (solid.elementKind === "wall") {
    return { kind: "wall", id: solid.elementId, storeyId: storey.id }
  }
  if (solid.elementKind === "opening") {
    const wall = storey.walls.find((candidate) =>
      candidate.openings.some((opening) => opening.id === solid.elementId)
    )
    if (!wall) return null
    return { kind: "opening", id: solid.elementId, wallId: wall.id, storeyId: storey.id }
  }
  if (solid.elementKind === "slab") return { kind: "slab", id: solid.elementId, storeyId: storey.id }
  if (solid.elementKind === "roof") return { kind: "roof", id: solid.elementId, storeyId: storey.id }
  if (solid.elementKind === "column") {
    return { kind: "column", id: solid.elementId, storeyId: storey.id }
  }
  return null
}

function resolveAppearance(solid: ElementSolid, storey: Storey, model: BuildingModel) {
  const material = solid.materialId
    ? model.materials.find((item) => item.id === solid.materialId)
    : undefined

  if (solid.elementKind === "roof") {
    return {
      color: material?.color ?? ELEMENT_COLORS.roof,
      transparent: false,
      roughness: 0.85,
      castShadow: true,
    }
  }

  if (solid.elementKind === "slab") {
    return {
      color: material?.color ?? ELEMENT_COLORS.slab,
      transparent: false,
      roughness: 0.9,
      castShadow: false,
    }
  }

  if (solid.elementKind === "column") {
    return {
      color: material?.color ?? ELEMENT_COLORS.column,
      transparent: false,
      roughness: 0.8,
      castShadow: true,
    }
  }

  const wall = storey.walls.find((candidate) => candidate.id === solid.elementId)
  const fallback =
    wall?.type === "exterior"
      ? ELEMENT_COLORS.exterior
      : wall?.type === "load_bearing"
        ? ELEMENT_COLORS.load_bearing
        : wall?.type === "partition"
          ? ELEMENT_COLORS.partition
          : ELEMENT_COLORS.interior

  return {
    color: material?.color ?? fallback,
    transparent: false,
    roughness: 0.96,
    castShadow: true,
  }
}

export { worldFromPlan }
