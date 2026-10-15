"use client"

/**
 * Mål i 3D, laget for en telefon på byggeplassen:
 *  - Trykk to punkter for å måle. Punktet trekkes til nærmeste hjørne eller
 *    kant (romsligere med finger enn med mus), så man treffer det man sikter på.
 *  - Målene lagres i modellen, så hele laget ser de samme tallene.
 *  - Trykk på en del (tegnet eller importert) for å se målene på den.
 *
 * Plukkingen er manuell (ikke r3f-hendelser) og skjer bare ved trykk, så store
 * IFC-modeller ikke testes mot hver eneste musebevegelse.
 */

import * as React from "react"
import { useThree } from "@react-three/fiber"
import { Html, Line } from "@react-three/drei"
import { Trash2, X } from "lucide-react"
import * as THREE from "three"

import { Button } from "@/components/ui/button"
import { wallLength } from "@/lib/cad/geometry"
import { elementGrenser, type ImportGeometri } from "@/lib/cad/import/geometri"
import type { IfcEgenskapsgruppe } from "@/lib/cad/import/ifc.worker"
import { formatMm, fraPlanPunkt, maleDeler, snappTilTrekant, type Snapp, type V3 } from "@/lib/cad/maling"
import { polygonArea } from "@/lib/cad/math"
import { OPENING_LABELS, ROOF_LABELS, SLAB_LABELS, WALL_TYPE_LABELS } from "@/lib/cad/presets"
import type { Measurement, ModelImport, SelectionRef, Storey } from "@/lib/cad/types"
import { cn } from "@/lib/utils"

export type PlukkResultat = Snapp & {
  /** Trykket traff en importert modell: hvilken fil og hvilket element. */
  importTreff: { importId: string; element: number } | null
}

export type PlukkFn = (clientX: number, clientY: number, grensePiksler: number) => PlukkResultat | null

const BAKKE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const MALEFARGE = "#0284c7"

/** Registrerer plukkefunksjonen (den trenger kamera og lerret fra r3f). */
export function Plukker({
  plukkRef,
  grupper,
}: {
  plukkRef: React.RefObject<PlukkFn | null>
  grupper: Array<React.RefObject<THREE.Group | null>>
}) {
  const camera = useThree((three) => three.camera)
  const gl = useThree((three) => three.gl)
  const raycaster = React.useMemo(() => {
    const r = new THREE.Raycaster()
    // Leses av three-mesh-bvh (drei sin <Bvh>): ett treff per mesh holder.
    ;(r as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true
    return r
  }, [])

  React.useEffect(() => {
    plukkRef.current = (clientX, clientY, grense) => {
      const rect = gl.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      )
      raycaster.setFromCamera(ndc, camera)
      const mal: THREE.Object3D[] = []
      for (const gruppe of grupper) {
        if (!gruppe.current) continue
        gruppe.current.updateMatrixWorld()
        mal.push(gruppe.current)
      }
      const treff = raycaster
        .intersectObjects(mal, true)
        .find((hit) => (hit.object as THREE.Mesh).isMesh && !hit.object.userData.ignorer && hit.face)

      if (!treff?.face) {
        // Ingenting traff: mål på bakken (tomta, avstand til nabo …).
        const punkt = raycaster.ray.intersectPlane(BAKKE, new THREE.Vector3())
        return punkt ? { punkt: punkt.toArray() as V3, type: "flate", importTreff: null } : null
      }

      const mesh = treff.object as THREE.Mesh
      const posisjoner = mesh.geometry.getAttribute("position")
      const hjorne = (indeks: number) =>
        new THREE.Vector3().fromBufferAttribute(posisjoner, indeks).applyMatrix4(mesh.matrixWorld).toArray() as V3
      const tilSkjerm = (v: V3): [number, number] => {
        const p = new THREE.Vector3(...v).project(camera)
        return [((p.x + 1) / 2) * rect.width, ((1 - p.y) / 2) * rect.height]
      }
      const snapp = snappTilTrekant(
        treff.point.toArray() as V3,
        [hjorne(treff.face.a), hjorne(treff.face.b), hjorne(treff.face.c)],
        tilSkjerm,
        grense
      )
      const data = mesh.userData as { importId?: string; elementer?: Uint32Array }
      const importTreff =
        data.importId && data.elementer ? { importId: data.importId, element: data.elementer[treff.face.a] } : null
      return { ...snapp, importTreff }
    }
    return () => {
      plukkRef.current = null
    }
  }, [camera, gl, grupper, plukkRef, raycaster])

  return null
}

// ---------------------------------------------------------------------------
// Mål i scenen
// ---------------------------------------------------------------------------

export function MalingLag({
  malinger,
  valgt,
  onVelg,
  start,
  peker,
}: {
  malinger: Measurement[]
  valgt: string | null
  onVelg: (id: string) => void
  /** Første punkt i en måling som pågår. */
  start: Snapp | null
  /** Der pekeren er nå (bare med mus), for en strek fra første punkt. */
  peker: Snapp | null
}) {
  return (
    <group>
      {malinger.map((maling) => (
        <MaleStrek
          key={maling.id}
          a={fraPlanPunkt(maling.a)}
          b={fraPlanPunkt(maling.b)}
          valgt={valgt === maling.id}
          onVelg={() => onVelg(maling.id)}
        />
      ))}
      {start && <Punktmerke punkt={start.punkt} type={start.type} />}
      {peker && <Punktmerke punkt={peker.punkt} type={peker.type} svak={!start} />}
      {start && peker && <MaleStrek a={start.punkt} b={peker.punkt} forelopig />}
    </group>
  )
}

function MaleStrek({
  a,
  b,
  valgt = false,
  forelopig = false,
  onVelg,
}: {
  a: V3
  b: V3
  valgt?: boolean
  forelopig?: boolean
  onVelg?: () => void
}) {
  const lengde = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const midt: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  return (
    <group>
      {/* Tegnes over alt annet: et mål gjennom en vegg skal fortsatt synes. */}
      <Line
        points={[a, b]}
        color={valgt ? "#0c4a6e" : MALEFARGE}
        lineWidth={valgt ? 3.5 : 2.5}
        dashed={forelopig}
        dashSize={0.15}
        gapSize={0.1}
        depthTest={false}
        renderOrder={10}
        userData={{ ignorer: true }}
      />
      {!forelopig && (
        <>
          <Punktmerke punkt={a} type="hjorne" liten />
          <Punktmerke punkt={b} type="hjorne" liten />
        </>
      )}
      {lengde > 0.001 && (
        <Html position={midt} center zIndexRange={[20, 0]} style={{ pointerEvents: forelopig ? "none" : "auto" }}>
          {forelopig ? (
            <span className="whitespace-nowrap rounded-full bg-sky-600/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white shadow">
              {formatMm(lengde)}
            </span>
          ) : (
            <button
              type="button"
              onClick={onVelg}
              className={cn(
                "whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white shadow-md ring-2 ring-white/80",
                valgt ? "bg-sky-900" : "bg-sky-600"
              )}
            >
              {formatMm(lengde)}
            </button>
          )}
        </Html>
      )}
    </group>
  )
}

function Punktmerke({ punkt, type, liten = false, svak = false }: { punkt: V3; type: Snapp["type"]; liten?: boolean; svak?: boolean }) {
  return (
    <Html position={punkt} center zIndexRange={[19, 0]} style={{ pointerEvents: "none" }}>
      <span
        className={cn(
          "block rounded-full border-2 border-white shadow",
          liten ? "size-2.5" : "size-3.5",
          // Firkant = festet til hjørne, rund = kant eller flate.
          type === "hjorne" && !liten && "rounded-[2px]",
          svak ? "bg-sky-600/50" : "bg-sky-600"
        )}
      />
    </Html>
  )
}

/** Veggens lengde på toppen av veggen (når «Mål på vegger» er på). */
export function VeggMal3D({ storeys }: { storeys: Storey[] }) {
  return (
    <group>
      {storeys.flatMap((storey) =>
        storey.walls.map((wall) => {
          const lengde = wallLength(wall)
          if (lengde < 0.4) return null
          const topp = storey.elevation + wall.baseOffset + wall.height + 0.12
          const midt: V3 = [(wall.a.x + wall.b.x) / 2, topp, -(wall.a.y + wall.b.y) / 2]
          return (
            <Html key={`${storey.id}:${wall.id}`} position={midt} center zIndexRange={[18, 0]} style={{ pointerEvents: "none" }}>
              <span className="whitespace-nowrap rounded-[4px] bg-background/85 px-1 text-[10px] font-medium tabular-nums text-foreground shadow-sm">
                {formatMm(lengde)}
              </span>
            </Html>
          )
        })
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------
// Infokort (vanlig DOM over scenen)
// ---------------------------------------------------------------------------

function Kort({ tittel, undertittel, onLukk, children }: { tittel: string; undertittel?: string; onLukk: () => void; children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto max-h-[45vh] overflow-y-auto rounded-[12px] border bg-background/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{tittel}</p>
          {undertittel && <p className="truncate text-xs text-muted-foreground">{undertittel}</p>}
        </div>
        <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 size-8" aria-label="Lukk" onClick={onLukk}>
          <X className="size-4" />
        </Button>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Malrad({ navn, verdi, stor = false }: { navn: string; verdi: string; stor?: boolean }) {
  // Hovedmålet står på egen linje: det er det man leser av på avstand.
  if (stor) {
    return (
      <div className="py-0.5">
        <div className="text-xs text-muted-foreground">{navn}</div>
        <div className="text-xl font-semibold tabular-nums">{verdi}</div>
      </div>
    )
  }
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-xs text-muted-foreground">{navn}</span>
      <span className="text-sm font-medium tabular-nums">{verdi}</span>
    </div>
  )
}

export function MalingKort({ maling, onSlett, onLukk }: { maling: Measurement; onSlett: () => void; onLukk: () => void }) {
  const deler = maleDeler(maling.a, maling.b)
  return (
    <Kort tittel="Mål" onLukk={onLukk}>
      <Malrad navn="Avstand" verdi={`${formatMm(deler.total)} mm`} stor />
      {deler.hoyde > 0.005 && deler.horisontalt > 0.005 && (
        <>
          <Malrad navn="Vannrett" verdi={`${formatMm(deler.horisontalt)} mm`} />
          <Malrad navn="Høydeforskjell" verdi={`${formatMm(deler.hoyde)} mm`} />
        </>
      )}
      <Button type="button" variant="ghost" size="sm" className="mt-1 h-9 gap-1.5 px-2 text-destructive hover:text-destructive" onClick={onSlett}>
        <Trash2 className="size-4" />
        Fjern målet
      </Button>
    </Kort>
  )
}

/** Mål på en tegnet del (vegg, åpning, dekke, tak, søyle, rom). */
export function ElementKort({ selection, storey, onLukk }: { selection: SelectionRef; storey: Storey; onLukk: () => void }) {
  const mm = (meter: number) => `${formatMm(meter)} mm`
  const m2 = (areal: number) => `${areal.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} m²`

  if (selection.kind === "wall") {
    const wall = storey.walls.find((item) => item.id === selection.id)
    if (!wall) return null
    return (
      <Kort tittel={wall.label || WALL_TYPE_LABELS[wall.type]} undertittel={storey.name} onLukk={onLukk}>
        <Malrad navn="Lengde" verdi={mm(wallLength(wall))} stor />
        <Malrad navn="Høyde" verdi={mm(wall.height)} />
        <Malrad navn="Tykkelse" verdi={mm(wall.thickness)} />
        {wall.openings.length > 0 && <Malrad navn="Dører og vinduer" verdi={String(wall.openings.length)} />}
      </Kort>
    )
  }
  if (selection.kind === "opening") {
    const opening = storey.walls.flatMap((wall) => wall.openings).find((item) => item.id === selection.id)
    if (!opening) return null
    return (
      <Kort tittel={opening.label || OPENING_LABELS[opening.kind]} undertittel={storey.name} onLukk={onLukk}>
        <Malrad navn="Bredde × høyde" verdi={`${formatMm(opening.width)} × ${formatMm(opening.height)} mm`} stor />
        {opening.kind !== "door" && <Malrad navn="Brystning" verdi={mm(opening.sill)} />}
      </Kort>
    )
  }
  if (selection.kind === "slab") {
    const slab = storey.slabs.find((item) => item.id === selection.id)
    if (!slab) return null
    return (
      <Kort tittel={slab.label || SLAB_LABELS[slab.kind]} undertittel={storey.name} onLukk={onLukk}>
        <Malrad navn="Areal" verdi={m2(polygonArea(slab.outline))} stor />
        <Malrad navn="Tykkelse" verdi={mm(slab.thickness)} />
      </Kort>
    )
  }
  if (selection.kind === "roof") {
    const roof = storey.roofs.find((item) => item.id === selection.id)
    if (!roof) return null
    return (
      <Kort tittel={roof.label || ROOF_LABELS[roof.kind]} undertittel={storey.name} onLukk={onLukk}>
        <Malrad navn="Takvinkel" verdi={`${roof.pitchDeg.toLocaleString("nb-NO")}°`} stor />
        <Malrad navn="Grunnflate" verdi={m2(polygonArea(roof.outline))} />
        <Malrad navn="Utstikk" verdi={mm(roof.overhang)} />
      </Kort>
    )
  }
  if (selection.kind === "column") {
    const column = storey.columns.find((item) => item.id === selection.id)
    if (!column) return null
    return (
      <Kort tittel={column.label || "Søyle"} undertittel={storey.name} onLukk={onLukk}>
        <Malrad navn="Bredde × dybde" verdi={`${formatMm(column.width)} × ${formatMm(column.depth)} mm`} stor />
        <Malrad navn="Høyde" verdi={mm(column.height)} />
      </Kort>
    )
  }
  if (selection.kind === "space") {
    const space = storey.spaces.find((item) => item.id === selection.id)
    if (!space) return null
    return (
      <Kort tittel={space.name} undertittel={storey.name} onLukk={onLukk}>
        <Malrad navn="Areal" verdi={m2(polygonArea(space.outline))} stor />
      </Kort>
    )
  }
  return null
}

/** Mål og egenskaper for en del av en importert modell. */
export function ImportElementKort({
  entry,
  geometri,
  element,
  hentInfo,
  onLukk,
}: {
  entry: ModelImport
  geometri: ImportGeometri
  element: number
  hentInfo?: (expressId: number) => Promise<IfcEgenskapsgruppe[]>
  onLukk: () => void
}) {
  const info = geometri.elementer[element]
  const grenser = React.useMemo(() => elementGrenser(geometri, element), [element, geometri])
  const [grupper, setGrupper] = React.useState<IfcEgenskapsgruppe[] | null>(null)

  React.useEffect(() => {
    setGrupper(null)
    if (!hentInfo || !info) return
    let aktiv = true
    void hentInfo(info.id).then((svar) => {
      if (aktiv) setGrupper(svar)
    })
    return () => {
      aktiv = false
    }
  }, [hentInfo, info])

  if (!info) return null

  // Utstrekning langs fila sine akser, i meter. Høyden er opp-aksen.
  let utstrekning: { b: number; d: number; h: number } | null = null
  if (grenser) {
    const s = entry.scale
    const x = (grenser.max[0] - grenser.min[0]) * s
    const y = (grenser.max[1] - grenser.min[1]) * s
    const z = (grenser.max[2] - grenser.min[2]) * s
    utstrekning = entry.upAxis === "z" ? { b: x, d: y, h: z } : { b: x, d: z, h: y }
  }

  // Mengder (Qto_…) først: det er dem man ser etter på byggeplassen.
  const sortert = grupper
    ? [...grupper].sort((a, b) => Number(/qto|quantit|mengde/i.test(b.navn)) - Number(/qto|quantit|mengde/i.test(a.navn)))
    : null

  return (
    <Kort tittel={info.navn || info.type} undertittel={info.navn ? `${info.type} · ${entry.name}` : entry.name} onLukk={onLukk}>
      {utstrekning && (
        <>
          <Malrad
            navn="Bredde × dybde × høyde"
            verdi={`${formatMm(utstrekning.b)} × ${formatMm(utstrekning.d)} × ${formatMm(utstrekning.h)} mm`}
            stor
          />
          <p className="text-[11px] text-muted-foreground">Ytre mål langs modellens akser.</p>
        </>
      )}
      {hentInfo && sortert === null && <p className="mt-2 text-xs text-muted-foreground">Henter egenskaper …</p>}
      {sortert && sortert.length > 0 && (
        <div className="mt-2 space-y-2 border-t pt-2">
          {sortert.slice(0, 6).map((gruppe) => (
            <div key={gruppe.navn}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{gruppe.navn}</p>
              {gruppe.egenskaper.slice(0, 12).map((egenskap) => (
                <div key={egenskap.navn} className="flex justify-between gap-3 py-0.5 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">{egenskap.navn}</span>
                  <span className="min-w-0 truncate text-right font-medium tabular-nums">{egenskap.verdi}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Kort>
  )
}
