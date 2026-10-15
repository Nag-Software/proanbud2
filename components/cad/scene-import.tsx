"use client"

/**
 * Importerte filer i 3D.
 *
 *  - 3D-modeller: én mesh per fargegruppe (se lib/cad/import/geometri.ts), så
 *    en IFC med titusenvis av deler tegnes med en håndfull tegnekall. Meshene
 *    har INGEN r3f-hendelser: da ville hver musebevegelse testet millioner av
 *    trekanter. Trykk plukkes i stedet manuelt, bare ved trykk (scene-maling).
 *  - Tegninger (DXF, PDF, bilde) ligger på gulvet i etasjen de hører til.
 *
 * Plasseringen speiler `modellTilVerden` i plassering.ts: opp-akse, skala,
 * rotasjon om loddlinjen og flytting — som tre nøstede grupper.
 */

import * as React from "react"
import * as THREE from "three"

import type { ImportGeometri } from "@/lib/cad/import/geometri"
import type { LastetTegning } from "@/lib/cad/import/last-tegning"
import { ELEMENT_COLORS } from "@/lib/cad/presets"
import type { ModelImport } from "@/lib/cad/types"

/** Over dette kaster modellen ikke skygge: skyggepasset ville doblet arbeidet. */
const SKYGGE_MAKS_TREKANTER = 1_000_000

/** Leses av plukkingen: hvilken fil, og elementnummer per hjørnepunkt. */
export type ImportMeshData = { importId: string; gruppe: number; elementer: Uint32Array }

export const ImportertModell = React.memo(function ImportertModell({
  entry,
  geometri,
  markert,
}: {
  entry: ModelImport
  geometri: ImportGeometri
  /** Elementet brukeren har trykket på (indeks i `geometri.elementer`). */
  markert: number | null
}) {
  const deler = React.useMemo(
    () =>
      geometri.grupper.map((gruppe, indeks) => {
        const buffer = new THREE.BufferGeometry()
        buffer.setAttribute("position", new THREE.BufferAttribute(gruppe.posisjoner, 3))
        if (gruppe.normaler) buffer.setAttribute("normal", new THREE.BufferAttribute(gruppe.normaler, 3))
        buffer.setIndex(new THREE.BufferAttribute(gruppe.indekser, 1))
        if (!gruppe.normaler) buffer.computeVertexNormals()
        buffer.computeBoundingBox()
        buffer.computeBoundingSphere()
        const farge = new THREE.Color().setRGB(gruppe.farge[0], gruppe.farge[1], gruppe.farge[2], THREE.SRGBColorSpace)
        return { buffer, farge, opasitet: gruppe.opasitet, data: { importId: entry.id, gruppe: indeks, elementer: gruppe.elementer } satisfies ImportMeshData }
      }),
    // Plasseringen ligger i gruppene rundt; geometrien bygges bare én gang per fil.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometri]
  )
  React.useEffect(() => () => deler.forEach((del) => del.buffer.dispose()), [deler])

  const markering = React.useMemo(() => (markert === null ? null : markeringsGeometri(geometri, markert)), [geometri, markert])
  React.useEffect(() => () => markering?.dispose(), [markering])

  const skygge = geometri.trekanter <= SKYGGE_MAKS_TREKANTER

  return (
    <PlasseringsGruppe entry={entry}>
      {deler.map((del, indeks) => {
        const opasitet = del.opasitet * entry.opacity
        const gjennomsiktig = opasitet < 0.99
        return (
          <mesh
            key={indeks}
            geometry={del.buffer}
            userData={del.data}
            castShadow={skygge && !gjennomsiktig}
            receiveShadow={skygge}
          >
            <meshStandardMaterial
              color={del.farge}
              roughness={0.85}
              metalness={0.02}
              side={THREE.DoubleSide}
              transparent={gjennomsiktig}
              opacity={opasitet}
              depthWrite={!gjennomsiktig}
            />
          </mesh>
        )
      })}
      {markering && (
        <mesh geometry={markering} renderOrder={5} userData={{ ignorer: true }}>
          <meshStandardMaterial
            color={ELEMENT_COLORS.selection}
            emissive={ELEMENT_COLORS.selection}
            emissiveIntensity={0.25}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      )}
    </PlasseringsGruppe>
  )
})

function PlasseringsGruppe({ entry, children }: { entry: ModelImport; children: React.ReactNode }) {
  return (
    <group position={[entry.offset.x, entry.elevation, -entry.offset.y]} rotation={[0, THREE.MathUtils.degToRad(entry.rotationDeg), 0]}>
      <group scale={entry.scale}>
        <group rotation={[entry.upAxis === "z" ? -Math.PI / 2 : 0, 0, 0]}>{children}</group>
      </group>
    </group>
  )
}

/** Trekantene som hører til ett element, til markering ved trykk. */
function markeringsGeometri(geometri: ImportGeometri, element: number): THREE.BufferGeometry | null {
  const posisjoner: number[] = []
  for (const gruppe of geometri.grupper) {
    const { indekser, elementer, posisjoner: p } = gruppe
    for (let i = 0; i + 2 < indekser.length; i += 3) {
      const a = indekser[i]
      if (elementer[a] !== element) continue
      for (const v of [a, indekser[i + 1], indekser[i + 2]]) posisjoner.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])
    }
  }
  if (posisjoner.length === 0) return null
  const buffer = new THREE.BufferGeometry()
  buffer.setAttribute("position", new THREE.Float32BufferAttribute(posisjoner, 3))
  buffer.computeVertexNormals()
  return buffer
}

// ---------------------------------------------------------------------------
// Tegninger på gulvet
// ---------------------------------------------------------------------------

export const ImportertTegning = React.memo(function ImportertTegning({
  entry,
  tegning,
  hoyde,
}: {
  entry: ModelImport
  tegning: LastetTegning
  /** Gulvnivået i etasjen tegningen hører til. */
  hoyde: number
}) {
  return (
    <group
      position={[entry.offset.x, hoyde + 0.015, -entry.offset.y]}
      rotation={[0, THREE.MathUtils.degToRad(entry.rotationDeg), 0]}
      scale={[entry.scale, 1, entry.scale]}
    >
      {tegning.type === "linjer" ? (
        <DxfLinjer3D tegning={tegning} opasitet={entry.opacity} />
      ) : (
        <Bilde3D tegning={tegning} opasitet={entry.opacity} />
      )}
    </group>
  )
})

function DxfLinjer3D({ tegning, opasitet }: { tegning: Extract<LastetTegning, { type: "linjer" }>; opasitet: number }) {
  // Relativt til tegningens hjørne (georefererte DXF-er ligger langt fra origo
  // og mister presisjon i 32-bits flyttall).
  const origo = tegning.grenser ? { x: tegning.grenser.minX, y: tegning.grenser.minY } : { x: 0, y: 0 }
  const buffer = React.useMemo(() => {
    const s = tegning.segmenter
    const antall = Math.floor(s.length / 4)
    const posisjoner = new Float32Array(antall * 6)
    for (let i = 0; i < antall; i++) {
      posisjoner[i * 6] = s[i * 4] - origo.x
      posisjoner[i * 6 + 2] = -(s[i * 4 + 1] - origo.y)
      posisjoner[i * 6 + 3] = s[i * 4 + 2] - origo.x
      posisjoner[i * 6 + 5] = -(s[i * 4 + 3] - origo.y)
    }
    const geometri = new THREE.BufferGeometry()
    geometri.setAttribute("position", new THREE.BufferAttribute(posisjoner, 3))
    return geometri
  }, [origo.x, origo.y, tegning.segmenter])
  React.useEffect(() => () => buffer.dispose(), [buffer])

  return (
    <group position={[origo.x, 0, -origo.y]}>
      <lineSegments geometry={buffer} userData={{ ignorer: true }}>
        <lineBasicMaterial color="#334155" transparent opacity={opasitet} />
      </lineSegments>
    </group>
  )
}

function Bilde3D({ tegning, opasitet }: { tegning: Extract<LastetTegning, { type: "bilde" }>; opasitet: number }) {
  const [tekstur, setTekstur] = React.useState<THREE.Texture | null>(null)
  React.useEffect(() => {
    let aktiv = true
    let lastet: THREE.Texture | null = null
    new THREE.TextureLoader().load(tegning.url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 4
      lastet = t
      if (aktiv) setTekstur(t)
      else t.dispose()
    })
    return () => {
      aktiv = false
      lastet?.dispose()
    }
  }, [tegning.url])

  const flate = React.useMemo(() => {
    // Bildet har y nedover fra øvre venstre hjørne: øverste kant ligger nordligst.
    const geometri = new THREE.PlaneGeometry(tegning.bredde, tegning.hoyde)
    geometri.rotateX(-Math.PI / 2)
    geometri.translate(tegning.bredde / 2, 0, tegning.hoyde / 2)
    return geometri
  }, [tegning.bredde, tegning.hoyde])
  React.useEffect(() => () => flate.dispose(), [flate])

  if (!tekstur) return null
  return (
    <mesh geometry={flate} receiveShadow userData={{ ignorer: true }}>
      <meshBasicMaterial map={tekstur} transparent opacity={opasitet} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}
