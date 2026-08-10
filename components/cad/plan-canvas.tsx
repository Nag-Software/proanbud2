"use client"

/**
 * 2D-planeditoren.
 *
 * SVG er valgt bevisst framfor canvas/WebGL her: plantegninger er få hundre
 * strøk, og SVG gir knivskarpe linjer på alle skjermer, gratis treffdeteksjon
 * og tekst som ikke må tegnes for hånd. 3D-visningen ved siden av er WebGL —
 * hver visning bruker den teknologien den er best tjent med, mot samme modell.
 *
 * Alt du kan gjøre med musa:
 *   - dra veggen i midten for å flytte hele veggen (naboer henger med)
 *   - dra et endepunkt for å strekke/rotere veggen (magnetsnapp mot andre
 *     endepunkter, rutenett og 15°-vinkler med Shift)
 *   - dra en dør/et vindu langs veggen
 *   - klikk med veggverktøyet for å tegne sammenhengende vegger
 *   - hjul zoomer mot pekeren, midtknapp/mellomrom panorerer
 */

import * as React from "react"

import {
  computeWallFootprints,
  expandOutline,
  footprintPolygon,
  pointOnWall,
  projectOntoWall,
  wallLength,
} from "@/lib/cad/geometry"
import {
  add,
  closestPointOnSegment,
  dedupePolygon,
  distance,
  normalize,
  perpendicular,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  scale as scaleVec,
  snapAngle,
  sub,
} from "@/lib/cad/math"
import { CadContextMenu } from "@/components/cad/cad-context-menu"
import { buildCadMenuItems, describeSelectionForMenu } from "@/components/cad/cad-menu-items"
import { ELEMENT_COLORS } from "@/lib/cad/presets"
import type { CadStore, OutlineKind } from "@/lib/cad/store"
import { useCadState } from "@/lib/cad/store"
import type { Point, SelectionRef, Storey, Wall } from "@/lib/cad/types"
import { cn } from "@/lib/utils"

type Viewport = { scale: number; panX: number; panY: number }

type DragState =
  | { kind: "none" }
  | { kind: "pan"; startX: number; startY: number; origin: Viewport }
  | { kind: "wall-move"; wallId: string; last: Point }
  | { kind: "wall-endpoint"; wallId: string; end: "a" | "b" }
  | { kind: "opening"; wallId: string; openingId: string }
  | { kind: "column"; columnId: string }
  | { kind: "outline-point"; outlineKind: OutlineKind; id: string; index: number }
  | { kind: "outline-edge"; outlineKind: OutlineKind; id: string; index: number; last: Point }

type DraftState =
  | { kind: "none" }
  | { kind: "wall"; points: Point[]; cursor: Point }
  | { kind: "polygon"; target: "slab" | "roof"; points: Point[]; cursor: Point }
  | { kind: "measure"; from: Point; to: Point }

const SNAP_PIXELS = 12

export function PlanCanvas({
  store,
  className,
  emptyState,
  onShowProperties,
  onAddFloorFromWalls,
  onAddRoofFromWalls,
}: {
  store: CadStore
  className?: string
  /** Vises midt i tegneflaten så lenge etasjen er tom. */
  emptyState?: React.ReactNode
  onShowProperties?: () => void
  onAddFloorFromWalls?: () => void
  onAddRoofFromWalls?: () => void
}) {
  const state = useCadState(store)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState({ width: 800, height: 600 })
  // Vi vet ikke hvor stor tegneflaten er før ResizeObserver har målt den.
  // Uten dette flagget kjøres «tilpass visningen» mot startgjetningen på
  // 800×600, og brukeren møter en plantegning som er zoomet langt inn.
  const [measured, setMeasured] = React.useState(false)
  const [viewport, setViewport] = React.useState<Viewport>({ scale: 40, panX: 400, panY: 300 })
  const [drag, setDrag] = React.useState<DragState>({ kind: "none" })
  const [draft, setDraft] = React.useState<DraftState>({ kind: "none" })
  const [hover, setHover] = React.useState<string | null>(null)
  const [shiftHeld, setShiftHeld] = React.useState(false)
  const [contextMenu, setContextMenu] = React.useState<{
    x: number
    y: number
    world: Point
  } | null>(null)
  // Så lenge brukeren ikke selv har zoomet eller panorert, holder vi
  // visningen tilpasset modellen. Da får man riktig utsnitt også når panelet
  // endrer størrelse — telefon som roteres, eller bytte mellom delt og full
  // visning — uten å overkjøre et utsnitt brukeren har valgt selv.
  const userAdjusted = React.useRef(false)

  const storey: Storey | null =
    state.model.storeys.find((item) => item.id === state.activeStoreyId) ??
    state.model.storeys[0] ??
    null

  const footprints = React.useMemo(
    () => computeWallFootprints(storey?.walls ?? []),
    [storey?.walls]
  )

  const isEmpty =
    (storey?.walls.length ?? 0) === 0 &&
    (storey?.slabs.length ?? 0) === 0 &&
    (storey?.roofs.length ?? 0) === 0 &&
    (storey?.columns.length ?? 0) === 0

  /**
   * Det valgte elementets omriss, når det er et dekke, tak eller rom.
   * Hvert hjørne og hver kant blir et gripepunkt — det er dette som gjør at
   * f.eks. et tak kan strekkes i én retning uten å røre resten.
   */
  const selectedOutline = React.useMemo((): {
    kind: OutlineKind
    id: string
    outline: Point[]
  } | null => {
    const selection = state.selection
    if (!selection || !storey) return null
    if (selection.kind === "slab") {
      const slab = storey.slabs.find((item) => item.id === selection.id)
      return slab ? { kind: "slab", id: slab.id, outline: slab.outline } : null
    }
    if (selection.kind === "roof") {
      const roof = storey.roofs.find((item) => item.id === selection.id)
      return roof ? { kind: "roof", id: roof.id, outline: roof.outline } : null
    }
    // Rom har ingen håndtak: de følger veggene. Vil du endre et rom, flytter du
    // veggen.
    return null
  }, [state.selection, storey])

  // --- Skjerm ↔ verden ------------------------------------------------------
  const toScreen = React.useCallback(
    (point: Point) => ({
      x: point.x * viewport.scale + viewport.panX,
      y: -point.y * viewport.scale + viewport.panY,
    }),
    [viewport]
  )

  const toWorld = React.useCallback(
    (x: number, y: number): Point => ({
      x: (x - viewport.panX) / viewport.scale,
      y: -(y - viewport.panY) / viewport.scale,
    }),
    [viewport]
  )

  const pointerWorld = React.useCallback(
    (event: React.PointerEvent | React.MouseEvent | React.WheelEvent): Point => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return toWorld(event.clientX - rect.left, event.clientY - rect.top)
    },
    [toWorld]
  )

  // --- Størrelse og innledende zoom ----------------------------------------
  React.useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box && box.width > 0 && box.height > 0) {
        setSize({ width: box.width, height: box.height })
        setMeasured(true)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitToModel = React.useCallback(() => {
    const points: Point[] = []
    for (const wall of storey?.walls ?? []) points.push(wall.a, wall.b)
    for (const slab of storey?.slabs ?? []) points.push(...slab.outline)
    for (const roof of storey?.roofs ?? []) points.push(...roof.outline)

    if (points.length === 0) {
      setViewport({ scale: 40, panX: size.width / 2, panY: size.height / 2 })
      return
    }

    const minX = Math.min(...points.map((point) => point.x))
    const maxX = Math.max(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y))
    const maxY = Math.max(...points.map((point) => point.y))
    const width = Math.max(maxX - minX, 1)
    const height = Math.max(maxY - minY, 1)
    const nextScale = Math.min(
      (size.width * 0.82) / width,
      (size.height * 0.82) / height,
      160
    )
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    setViewport({
      scale: nextScale,
      panX: size.width / 2 - centerX * nextScale,
      panY: size.height / 2 + centerY * nextScale,
    })
  }, [size.height, size.width, storey?.roofs, storey?.slabs, storey?.walls])

  // Refit skal skje når FLATEN endrer størrelse — ikke når modellen endrer seg.
  // Uten ref-en her ville hver eneste vegg brukeren tegner ha re-sentrert
  // tegningen under hånda på ham, siden fitToModel avhenger av veggene.
  const fitRef = React.useRef(fitToModel)
  React.useEffect(() => {
    fitRef.current = fitToModel
  })

  React.useEffect(() => {
    if (userAdjusted.current) return
    if (!measured || size.width < 50) return
    fitRef.current()
  }, [measured, size.height, size.width])

  // Første gang etasjen får geometri — via rektangel-snarveien, KI-generering
  // eller den første veggen — må utsnittet hoppe til bygget. Ellers står
  // brukeren igjen med tomrommet han zoomet til da tegningen var blank.
  const wasEmpty = React.useRef(isEmpty)
  React.useEffect(() => {
    if (wasEmpty.current && !isEmpty && !userAdjusted.current && measured) {
      fitRef.current()
    }
    wasEmpty.current = isEmpty
  }, [isEmpty, measured])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => setShiftHeld(event.shiftKey)
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKey)
    }
  }, [])

  // --- Snapping -------------------------------------------------------------
  const snapWorldPoint = React.useCallback(
    (point: Point, options: { ignoreWallId?: string; from?: Point } = {}) => {
      const threshold = SNAP_PIXELS / viewport.scale

      // 1. Magnet mot eksisterende endepunkter — viktigst, gir tette hjørner.
      let best: Point | null = null
      let bestDistance = threshold
      for (const wall of storey?.walls ?? []) {
        for (const candidate of [wall.a, wall.b]) {
          const candidateDistance = distance(point, candidate)
          if (candidateDistance < bestDistance) {
            bestDistance = candidateDistance
            best = candidate
          }
        }
      }
      if (best) return { point: best, snapped: "endepunkt" as const }

      // 2. Nærmeste punkt på en annen veggs senterlinje (T-skjøt).
      for (const wall of storey?.walls ?? []) {
        if (wall.id === options.ignoreWallId) continue
        const projection = closestPointOnSegment(point, wall.a, wall.b)
        if (projection.distance < bestDistance) {
          bestDistance = projection.distance
          best = projection.point
        }
      }
      if (best) return { point: best, snapped: "vegg" as const }

      // 3. Vinkellås mot forrige punkt (Shift).
      if (shiftHeld && options.from) {
        return { point: store.snap(snapAngle(options.from, point, 15)), snapped: "vinkel" as const }
      }

      // 4. Rutenett.
      return { point: store.snap(point), snapped: "rutenett" as const }
    },
    [shiftHeld, store, storey?.walls, viewport.scale]
  )

  // --- Treffdeteksjon -------------------------------------------------------
  const hitTest = React.useCallback(
    (point: Point): { selection: SelectionRef; handle?: "a" | "b" } | null => {
      if (!storey) return null
      const handleRadius = 10 / viewport.scale

      // Endepunkthåndtak vinner alltid — det er der brukeren sikter.
      for (const wall of storey.walls) {
        if (distance(point, wall.a) < handleRadius) {
          return { selection: { kind: "wall", id: wall.id, storeyId: storey.id }, handle: "a" }
        }
        if (distance(point, wall.b) < handleRadius) {
          return { selection: { kind: "wall", id: wall.id, storeyId: storey.id }, handle: "b" }
        }
      }

      // Takmerkelappen ligger over alt annet: takomrisset følger som regel
      // veggene, og uten et eget gripepunkt ville taket vært umulig å velge.
      for (const roof of storey.roofs) {
        if (roof.outline.length < 3) continue
        if (distance(point, polygonCentroid(roof.outline)) < 16 / viewport.scale) {
          return { selection: { kind: "roof", id: roof.id, storeyId: storey.id } }
        }
      }

      // Åpninger før veggkropp, ellers kan de ikke velges.
      for (const wall of storey.walls) {
        for (const opening of wall.openings) {
          const center = pointOnWall(wall, opening.distance)
          if (distance(point, center) < Math.max(opening.width / 2, handleRadius)) {
            const projection = closestPointOnSegment(point, wall.a, wall.b)
            if (projection.distance <= wall.thickness) {
              return {
                selection: {
                  kind: "opening",
                  id: opening.id,
                  wallId: wall.id,
                  storeyId: storey.id,
                },
              }
            }
          }
        }
      }

      for (const wall of storey.walls) {
        const footprint = footprints.get(wall.id)
        if (!footprint) continue
        if (pointInPolygon(point, footprintPolygon(footprint))) {
          return { selection: { kind: "wall", id: wall.id, storeyId: storey.id } }
        }
      }

      for (const column of storey.columns) {
        if (distance(point, column.position) < Math.max(column.width, column.depth)) {
          return { selection: { kind: "column", id: column.id, storeyId: storey.id } }
        }
      }

      // Taket treffes på KONTUREN, ikke på flaten. Det er konturen som tegnes
      // (stiplet), og et tak som dekker hele planet ville ellers gjort både rom
      // og dekke umulige å klikke på.
      const outlineGrab = 8 / viewport.scale
      for (const roof of storey.roofs) {
        for (let i = 0; i < roof.outline.length; i++) {
          const from = roof.outline[i]
          const to = roof.outline[(i + 1) % roof.outline.length]
          if (closestPointOnSegment(point, from, to).distance <= outlineGrab) {
            return { selection: { kind: "roof", id: roof.id, storeyId: storey.id } }
          }
        }
      }

      for (const space of storey.spaces) {
        if (pointInPolygon(point, space.outline)) {
          return { selection: { kind: "space", id: space.id, storeyId: storey.id } }
        }
      }

      for (const slab of storey.slabs) {
        if (pointInPolygon(point, slab.outline)) {
          return { selection: { kind: "slab", id: slab.id, storeyId: storey.id } }
        }
      }

      return null
    },
    [footprints, storey, viewport.scale]
  )

  // --- Pekerhåndtering ------------------------------------------------------
  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // setPointerCapture kaster hvis peker-id-en ikke er aktiv (skjer bl.a. ved
    // syntetiske hendelser og på enkelte pekeplater). Sto den ubeskyttet her,
    // tok den med seg HELE klikket — verktøyene så ut til å være døde.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Uten capture mister vi bare drag utenfor flaten; klikk virker fortsatt.
    }
    const world = pointerWorld(event)

    // Høyreklikk er reservert kontekstmenyen. Panorering: midtknapp, eller
    // Alt + venstre.
    if (event.button === 2) return
    if (event.button === 1 || (state.tool === "select" && event.altKey && !selectedOutline)) {
      setDrag({ kind: "pan", startX: event.clientX, startY: event.clientY, origin: viewport })
      return
    }
    if (event.button !== 0) return

    if (state.tool === "wall") {
      const snapped = snapWorldPoint(world, {
        from: draft.kind === "wall" ? draft.points[draft.points.length - 1] : undefined,
      })
      setDraft((current) =>
        current.kind === "wall"
          ? { ...current, points: [...current.points, snapped.point], cursor: snapped.point }
          : { kind: "wall", points: [snapped.point], cursor: snapped.point }
      )
      return
    }

    if (state.tool === "slab" || state.tool === "roof") {
      const snapped = snapWorldPoint(world, {
        from: draft.kind === "polygon" ? draft.points[draft.points.length - 1] : undefined,
      })
      setDraft((current) =>
        current.kind === "polygon"
          ? { ...current, points: [...current.points, snapped.point], cursor: snapped.point }
          : { kind: "polygon", target: state.tool as "slab" | "roof", points: [snapped.point], cursor: snapped.point }
      )
      return
    }

    if (state.tool === "measure") {
      const snapped = snapWorldPoint(world)
      setDraft({ kind: "measure", from: snapped.point, to: snapped.point })
      return
    }

    if (state.tool === "column") {
      store.addColumn(snapWorldPoint(world).point)
      store.setTool("select")
      return
    }

    if (state.tool === "door" || state.tool === "window" || state.tool === "opening") {
      const target = nearestWall(storey, world)
      if (!target) return
      const along = projectOntoWall(target.wall, world)
      const openingId = store.addOpening(target.wall.id, state.tool, along)
      if (openingId && storey) {
        store.setSelection({
          kind: "opening",
          id: openingId,
          wallId: target.wall.id,
          storeyId: storey.id,
        })
      }
      store.setTool("select")
      return
    }

    // Velg-verktøyet. Omriss-håndtak har forrang: de ligger oppå elementet, og
    // det er dem brukeren sikter på når han vil strekke et tak eller et dekke.
    if (selectedOutline) {
      const grab = 10 / viewport.scale
      const { kind, id, outline } = selectedOutline

      for (let index = 0; index < outline.length; index++) {
        if (distance(world, outline[index]) > grab) continue
        if (event.altKey) {
          // Alt+klikk fjerner hjørnet — den vanlige CAD-gesten.
          store.removeOutlinePoint(kind, id, index)
        } else {
          setDrag({ kind: "outline-point", outlineKind: kind, id, index })
        }
        return
      }

      for (let index = 0; index < outline.length; index++) {
        const from = outline[index]
        const to = outline[(index + 1) % outline.length]
        const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
        if (distance(world, middle) > grab) continue
        if (event.altKey) {
          store.insertOutlinePoint(kind, id, index)
        } else {
          setDrag({ kind: "outline-edge", outlineKind: kind, id, index, last: world })
        }
        return
      }
    }

    const hit = hitTest(world)
    if (!hit) {
      store.setSelection(null)
      setDrag({ kind: "pan", startX: event.clientX, startY: event.clientY, origin: viewport })
      return
    }

    store.setSelection(hit.selection)

    if (hit.selection.kind === "wall" && hit.handle) {
      setDrag({ kind: "wall-endpoint", wallId: hit.selection.id, end: hit.handle })
      return
    }
    if (hit.selection.kind === "wall") {
      setDrag({ kind: "wall-move", wallId: hit.selection.id, last: world })
      return
    }
    if (hit.selection.kind === "opening") {
      setDrag({ kind: "opening", wallId: hit.selection.wallId, openingId: hit.selection.id })
      return
    }
    if (hit.selection.kind === "column") {
      setDrag({ kind: "column", columnId: hit.selection.id })
    }
  }

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const world = pointerWorld(event)

    if (draft.kind === "wall" || draft.kind === "polygon") {
      const snapped = snapWorldPoint(world, { from: draft.points[draft.points.length - 1] })
      setDraft({ ...draft, cursor: snapped.point })
      return
    }
    if (draft.kind === "measure") {
      setDraft({ ...draft, to: snapWorldPoint(world).point })
      return
    }

    if (drag.kind === "none") {
      const hit = hitTest(world)
      setHover(hit ? hit.selection.id : null)
      return
    }

    if (drag.kind === "pan") {
      userAdjusted.current = true
      setViewport({
        scale: drag.origin.scale,
        panX: drag.origin.panX + (event.clientX - drag.startX),
        panY: drag.origin.panY + (event.clientY - drag.startY),
      })
      return
    }

    if (drag.kind === "wall-move") {
      const raw = sub(world, drag.last)
      const gridSize = state.model.meta.gridSize || 0.1
      // Snapp forflytningen, ikke posisjonen: da beholder veggen sin egen
      // avstand til naboene i stedet for å hoppe til nærmeste rutelinje.
      const delta = {
        x: Math.round(raw.x / gridSize) * gridSize,
        y: Math.round(raw.y / gridSize) * gridSize,
      }
      if (delta.x === 0 && delta.y === 0) return
      store.moveWall(drag.wallId, delta, { transient: true })
      setDrag({ ...drag, last: { x: drag.last.x + delta.x, y: drag.last.y + delta.y } })
      return
    }

    if (drag.kind === "wall-endpoint") {
      const wall = storey?.walls.find((item) => item.id === drag.wallId)
      if (!wall) return
      const anchor = drag.end === "a" ? wall.b : wall.a
      const snapped = snapWorldPoint(world, { ignoreWallId: wall.id, from: anchor })
      store.moveWallEndpoint(drag.wallId, drag.end, snapped.point, { transient: true })
      return
    }

    if (drag.kind === "opening") {
      const wall = storey?.walls.find((item) => item.id === drag.wallId)
      if (!wall) return
      const along = projectOntoWall(wall, world)
      store.updateOpening(drag.wallId, drag.openingId, { distance: along }, { transient: true })
      return
    }

    if (drag.kind === "column") {
      store.updateColumn(drag.columnId, { position: snapWorldPoint(world).point }, { transient: true })
      return
    }

    if (drag.kind === "outline-point") {
      store.moveOutlinePoint(
        drag.outlineKind,
        drag.id,
        drag.index,
        snapWorldPoint(world).point,
        { transient: true }
      )
      return
    }

    if (drag.kind === "outline-edge") {
      const gridSize = state.model.meta.gridSize || 0.1
      const raw = sub(world, drag.last)
      // Snapp forflytningen, ikke posisjonen — kanten beholder sin egen
      // avstand til resten av omrisset.
      const delta = {
        x: Math.round(raw.x / gridSize) * gridSize,
        y: Math.round(raw.y / gridSize) * gridSize,
      }
      if (delta.x === 0 && delta.y === 0) return
      store.moveOutlineEdge(drag.outlineKind, drag.id, drag.index, delta, { transient: true })
      setDrag({ ...drag, last: { x: drag.last.x + delta.x, y: drag.last.y + delta.y } })
    }
  }

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Samme som over: capture er en bekvemmelighet, ikke en forutsetning.
    }
    if (drag.kind !== "none" && drag.kind !== "pan") {
      store.commitTransient()
    }
    setDrag({ kind: "none" })
  }

  const finishDraft = React.useCallback(() => {
    if (draft.kind === "wall" && draft.points.length >= 2) {
      for (let i = 0; i < draft.points.length - 1; i++) {
        store.addWall(draft.points[i], draft.points[i + 1], "exterior")
      }
    }
    if (draft.kind === "polygon") {
      // Dobbeltklikket som avslutter flaten rekker å legge inn punkt på samme
      // sted først. De må bort før elementet lages, ellers får omrisset et
      // hjørne uten retning.
      const outline = dedupePolygon(draft.points)
      if (outline.length >= 3) {
        if (draft.target === "slab") store.addSlab(outline)
        else store.addRoof(outline)
      }
    }
    setDraft({ kind: "none" })
    store.setTool("select")
  }, [draft, store])

  const handleDoubleClick = () => {
    if (draft.kind !== "none") finishDraft()
  }

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft({ kind: "none" })
        store.setTool("select")
      }
      if (event.key === "Enter" && draft.kind !== "none") {
        finishDraft()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [draft.kind, finishDraft, store])

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    userAdjusted.current = true
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
    const nextScale = Math.min(Math.max(viewport.scale * factor, 4), 600)
    // Hold punktet under pekeren i ro mens vi zoomer.
    setViewport({
      scale: nextScale,
      panX: pointerX - ((pointerX - viewport.panX) / viewport.scale) * nextScale,
      panY: pointerY - ((pointerY - viewport.panY) / viewport.scale) * nextScale,
    })
  }

  // --- Tegning --------------------------------------------------------------
  const gridLines = React.useMemo(() => {
    if (!state.showGrid) return null
    const step = pickGridStep(viewport.scale)
    const topLeft = toWorld(0, 0)
    const bottomRight = toWorld(size.width, size.height)
    const lines: React.ReactElement[] = []

    const startX = Math.floor(topLeft.x / step) * step
    const endX = Math.ceil(bottomRight.x / step) * step
    for (let x = startX; x <= endX; x += step) {
      const screen = toScreen({ x, y: 0 })
      const isMajor = Math.abs(x % (step * 5)) < step / 2
      lines.push(
        <line
          key={`vx${x.toFixed(3)}`}
          x1={screen.x}
          y1={0}
          x2={screen.x}
          y2={size.height}
          className={isMajor ? "stroke-border" : "stroke-border/50"}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      )
    }

    const startY = Math.floor(bottomRight.y / step) * step
    const endY = Math.ceil(topLeft.y / step) * step
    for (let y = startY; y <= endY; y += step) {
      const screen = toScreen({ x: 0, y })
      const isMajor = Math.abs(y % (step * 5)) < step / 2
      lines.push(
        <line
          key={`hy${y.toFixed(3)}`}
          x1={0}
          y1={screen.y}
          x2={size.width}
          y2={screen.y}
          className={isMajor ? "stroke-border" : "stroke-border/50"}
          strokeWidth={isMajor ? 1 : 0.5}
        />
      )
    }

    return lines
  }, [size.height, size.width, state.showGrid, toScreen, toWorld, viewport.scale])

  const selectedId = state.selection?.id ?? null

  const polygonPoints = (points: Point[]) =>
    points.map((point) => {
      const screen = toScreen(point)
      return `${screen.x},${screen.y}`
    }).join(" ")

  return (
    <div ref={containerRef} className={cn("relative h-full w-full overflow-hidden bg-background", className)}>
      <svg
        width={size.width}
        height={size.height}
        className={cn(
          "touch-none select-none",
          state.tool === "select" ? "cursor-default" : "cursor-crosshair",
          drag.kind === "pan" && "cursor-grabbing"
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={(event) => {
          event.preventDefault()
          const rect = containerRef.current?.getBoundingClientRect()
          if (!rect) return
          const world = pointerWorld(event)
          // Høyreklikk velger det du peker på, slik at menyen alltid gjelder
          // elementet under pekeren — ikke det som tilfeldigvis var valgt før.
          const hit = hitTest(world)
          store.setSelection(hit?.selection ?? null)
          setContextMenu({
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            world,
          })
        }}
      >
        {gridLines}

        {/* Dekker under alt annet */}
        {storey?.slabs.map((slab) => (
          <polygon
            key={slab.id}
            points={polygonPoints(slab.outline)}
            className={cn(
              "fill-muted/40 stroke-muted-foreground/40",
              selectedId === slab.id && "fill-primary/10 stroke-primary"
            )}
            strokeDasharray="6 4"
            strokeWidth={1.5}
          />
        ))}

        {/* Rom */}
        {state.showRooms &&
          storey?.spaces.map((space) => {
            const center = toScreen(polygonCentroid(space.outline))
            const area = polygonArea(space.outline)
            return (
              <g key={space.id}>
                <polygon
                  points={polygonPoints(space.outline)}
                  className={cn(
                    "fill-primary/5 stroke-primary/20",
                    selectedId === space.id && "fill-primary/15 stroke-primary/60"
                  )}
                  strokeWidth={1}
                />
                {viewport.scale > 14 && (
                  <>
                    <text
                      x={center.x}
                      y={center.y - 2}
                      textAnchor="middle"
                      className="pointer-events-none fill-foreground text-[11px] font-medium"
                    >
                      {space.name}
                    </text>
                    <text
                      x={center.x}
                      y={center.y + 12}
                      textAnchor="middle"
                      className="pointer-events-none fill-muted-foreground text-[10px]"
                    >
                      {area.toFixed(1).replace(".", ",")} m²
                    </text>
                  </>
                )}
              </g>
            )
          })}

        {/* Takomriss. Den stiplede linja viser takets FAKTISKE utstrekning,
            altså inkludert utstikk — det er den som betyr noe for tekking og
            for hvor mye som stikker ut over veggen. */}
        {storey?.roofs.map((roof) => {
          const covered = roof.overhang > 0 ? expandOutline(roof.outline, roof.overhang) : roof.outline
          const badge = toScreen(polygonCentroid(roof.outline))
          const isRoofSelected = selectedId === roof.id
          return (
            <g key={roof.id}>
              <polygon
                points={polygonPoints(covered)}
                className={cn(
                  "fill-none stroke-amber-500/70",
                  isRoofSelected && "stroke-primary"
                )}
                strokeDasharray="10 6"
                strokeWidth={2}
              />
              {viewport.scale > 10 && (
                <g className="cursor-pointer">
                  <rect
                    x={badge.x - 18}
                    y={badge.y - 9}
                    width={36}
                    height={18}
                    rx={9}
                    className={cn(
                      "stroke-background",
                      isRoofSelected ? "fill-primary" : "fill-amber-500/90"
                    )}
                    strokeWidth={1.5}
                  />
                  <text
                    x={badge.x}
                    y={badge.y + 4}
                    textAnchor="middle"
                    className="pointer-events-none fill-white text-[10px] font-medium"
                  >
                    Tak
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* Vegger */}
        {storey?.walls.map((wall) => {
          const footprint = footprints.get(wall.id)
          if (!footprint) return null
          const isSelected = selectedId === wall.id
          const isHovered = hover === wall.id

          return (
            <g key={wall.id}>
              <polygon
                points={polygonPoints(footprintPolygon(footprint))}
                fill={
                  isSelected
                    ? ELEMENT_COLORS.selection
                    : wall.type === "exterior"
                      ? "currentColor"
                      : "currentColor"
                }
                className={cn(
                  isSelected
                    ? "text-primary opacity-90"
                    : wall.type === "exterior"
                      ? "text-foreground/85"
                      : "text-foreground/55",
                  isHovered && !isSelected && "opacity-80"
                )}
                stroke={isSelected ? ELEMENT_COLORS.selection : "none"}
                strokeWidth={isSelected ? 2 : 0}
              />

              {/* Åpninger tegnes som hvitt gap med karmstreker */}
              {wall.openings.map((opening) => {
                const direction = normalize(sub(wall.b, wall.a))
                const normal = perpendicular(direction)
                const half = wall.thickness / 2 + 0.01
                const start = add(wall.a, scaleVec(direction, opening.distance - opening.width / 2))
                const end = add(wall.a, scaleVec(direction, opening.distance + opening.width / 2))
                const quad = [
                  add(start, scaleVec(normal, half)),
                  add(end, scaleVec(normal, half)),
                  add(end, scaleVec(normal, -half)),
                  add(start, scaleVec(normal, -half)),
                ]
                const isOpeningSelected = selectedId === opening.id
                const screenStart = toScreen(start)
                const screenEnd = toScreen(end)

                return (
                  <g key={opening.id}>
                    <polygon
                      points={polygonPoints(quad)}
                      className="fill-background"
                      stroke={isOpeningSelected ? ELEMENT_COLORS.selection : "none"}
                      strokeWidth={isOpeningSelected ? 2 : 0}
                    />
                    <line
                      x1={screenStart.x}
                      y1={screenStart.y}
                      x2={screenEnd.x}
                      y2={screenEnd.y}
                      className={cn(
                        opening.kind === "window" ? "stroke-sky-500" : "stroke-amber-600",
                        isOpeningSelected && "stroke-primary"
                      )}
                      strokeWidth={opening.kind === "window" ? 3 : 2}
                    />
                    {opening.kind === "door" && viewport.scale > 20 && (
                      <path
                        d={doorSwingPath(start, end, normal, toScreen)}
                        className="fill-none stroke-amber-600/60"
                        strokeWidth={1}
                      />
                    )}
                  </g>
                )
              })}

              {/* Målsetting */}
              {state.showDimensions && viewport.scale > 16 && (
                <WallDimension wall={wall} toScreen={toScreen} />
              )}

              {/* Endepunkthåndtak på valgt vegg */}
              {isSelected &&
                (["a", "b"] as const).map((end) => {
                  const screen = toScreen(end === "a" ? wall.a : wall.b)
                  return (
                    <circle
                      key={end}
                      cx={screen.x}
                      cy={screen.y}
                      r={6}
                      className="fill-background stroke-primary"
                      strokeWidth={2.5}
                    />
                  )
                })}
            </g>
          )
        })}

        {/* Søyler */}
        {storey?.columns.map((column) => {
          const half = { x: column.width / 2, y: column.depth / 2 }
          const corners = [
            { x: column.position.x - half.x, y: column.position.y - half.y },
            { x: column.position.x + half.x, y: column.position.y - half.y },
            { x: column.position.x + half.x, y: column.position.y + half.y },
            { x: column.position.x - half.x, y: column.position.y + half.y },
          ]
          return (
            <polygon
              key={column.id}
              points={polygonPoints(corners)}
              className={cn(
                "fill-foreground/70",
                selectedId === column.id && "fill-primary stroke-primary"
              )}
              strokeWidth={2}
            />
          )
        })}

        {/* Omriss-håndtak: hjørner (sirkler) og kanter (firkanter) */}
        {selectedOutline && (
          <g>
            {selectedOutline.outline.map((point, index) => {
              const screen = toScreen(point)
              return (
                <circle
                  key={`v${index}`}
                  cx={screen.x}
                  cy={screen.y}
                  r={6}
                  className="cursor-pointer fill-background stroke-primary"
                  strokeWidth={2.5}
                />
              )
            })}
            {selectedOutline.outline.map((point, index) => {
              const next = selectedOutline.outline[(index + 1) % selectedOutline.outline.length]
              const middle = toScreen({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 })
              return (
                <rect
                  key={`e${index}`}
                  x={middle.x - 4}
                  y={middle.y - 4}
                  width={8}
                  height={8}
                  rx={1.5}
                  className="cursor-pointer fill-primary/80 stroke-background"
                  strokeWidth={1.5}
                />
              )
            })}
          </g>
        )}

        {/* Kladd under tegning */}
        {draft.kind === "wall" && (
          <DraftPolyline
            points={[...draft.points, draft.cursor]}
            toScreen={toScreen}
            closed={false}
          />
        )}
        {draft.kind === "polygon" && (
          <DraftPolyline points={[...draft.points, draft.cursor]} toScreen={toScreen} closed />
        )}
        {draft.kind === "measure" && (
          <MeasureLine from={draft.from} to={draft.to} toScreen={toScreen} />
        )}
      </svg>

      <PlanOverlay
        viewport={viewport}
        onZoom={(factor) => {
          userAdjusted.current = true
          setViewport((current) => ({
            ...current,
            scale: Math.min(Math.max(current.scale * factor, 4), 600),
          }))
        }}
        onFit={() => {
          userAdjusted.current = false
          fitToModel()
        }}
        hint={
          draft.kind === "wall"
            ? `Klikk for neste hjørne (${draft.points.length} satt)`
            : draft.kind === "polygon"
              ? `Klikk rundt omrisset (${draft.points.length} hjørner satt)`
              : state.tool === "door" || state.tool === "window"
                ? "Klikk på en vegg for å sette inn"
                : state.tool === "column"
                  ? "Klikk der søylen skal stå"
                  : state.tool === "measure"
                    ? "Dra mellom to punkter for å måle"
                    : selectedOutline
                      ? "Dra hjørner og kanter · Alt-klikk legger til eller fjerner hjørne"
                      : null
        }
        draftPointCount={
          draft.kind === "wall" || draft.kind === "polygon" ? draft.points.length : null
        }
        minimumPoints={draft.kind === "polygon" ? 3 : 2}
        showCancel={state.tool !== "select"}
        onFinishDraft={finishDraft}
        onCancelDraft={() => {
          setDraft({ kind: "none" })
          store.setTool("select")
        }}
      />

      {contextMenu && (
        <CadContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={describeSelectionForMenu(state.selection, storey)}
          onClose={() => setContextMenu(null)}
          items={buildCadMenuItems({
            store,
            storey,
            selection: state.selection,
            worldPoint: contextMenu.world,
            onShowProperties: () => onShowProperties?.(),
            onAddFloorFromWalls: () => onAddFloorFromWalls?.(),
            onAddRoofFromWalls: () => onAddRoofFromWalls?.(),
          })}
        />
      )}

      {isEmpty && emptyState && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-full max-w-md">{emptyState}</div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deler
// ---------------------------------------------------------------------------

function WallDimension({
  wall,
  toScreen,
}: {
  wall: Wall
  toScreen: (point: Point) => { x: number; y: number }
}) {
  const length = wallLength(wall)
  if (length < 0.4) return null

  const direction = normalize(sub(wall.b, wall.a))
  const normal = perpendicular(direction)
  const mid = scaleVec(add(wall.a, wall.b), 0.5)
  const offset = add(mid, scaleVec(normal, wall.thickness / 2 + 0.22))
  const screen = toScreen(offset)
  const angle = (Math.atan2(-direction.y, direction.x) * 180) / Math.PI
  const flipped = angle > 90 || angle < -90

  return (
    <text
      x={screen.x}
      y={screen.y}
      textAnchor="middle"
      transform={`rotate(${flipped ? angle + 180 : angle} ${screen.x} ${screen.y})`}
      className="pointer-events-none fill-muted-foreground text-[10px] tabular-nums"
    >
      {Math.round(length * 1000)}
    </text>
  )
}

function DraftPolyline({
  points,
  toScreen,
  closed,
}: {
  points: Point[]
  toScreen: (point: Point) => { x: number; y: number }
  closed: boolean
}) {
  if (points.length < 2) {
    const single = toScreen(points[0])
    return <circle cx={single.x} cy={single.y} r={4} className="fill-primary" />
  }

  const screenPoints = points.map(toScreen)
  const last = points[points.length - 1]
  const previous = points[points.length - 2]
  const segmentLength = distance(previous, last)
  const midpoint = toScreen(scaleVec(add(previous, last), 0.5))
  const angle = (Math.atan2(last.y - previous.y, last.x - previous.x) * 180) / Math.PI

  return (
    <g>
      <polyline
        points={screenPoints.map((point) => `${point.x},${point.y}`).join(" ")}
        className="fill-none stroke-primary"
        strokeWidth={2}
        strokeDasharray="6 4"
      />
      {closed && screenPoints.length > 2 && (
        <line
          x1={screenPoints[screenPoints.length - 1].x}
          y1={screenPoints[screenPoints.length - 1].y}
          x2={screenPoints[0].x}
          y2={screenPoints[0].y}
          className="stroke-primary/40"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}
      {screenPoints.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={3.5} className="fill-primary" />
      ))}
      {segmentLength > 0.01 && (
        <g>
          <rect
            x={midpoint.x - 34}
            y={midpoint.y - 26}
            width={68}
            height={20}
            rx={4}
            className="fill-primary"
          />
          <text
            x={midpoint.x}
            y={midpoint.y - 12}
            textAnchor="middle"
            className="fill-primary-foreground text-[10px] font-medium tabular-nums"
          >
            {Math.round(segmentLength * 1000)} · {Math.round(((angle % 360) + 360) % 360)}°
          </text>
        </g>
      )}
    </g>
  )
}

function MeasureLine({
  from,
  to,
  toScreen,
}: {
  from: Point
  to: Point
  toScreen: (point: Point) => { x: number; y: number }
}) {
  const screenFrom = toScreen(from)
  const screenTo = toScreen(to)
  const mid = { x: (screenFrom.x + screenTo.x) / 2, y: (screenFrom.y + screenTo.y) / 2 }
  const length = distance(from, to)

  return (
    <g>
      <line
        x1={screenFrom.x}
        y1={screenFrom.y}
        x2={screenTo.x}
        y2={screenTo.y}
        className="stroke-sky-500"
        strokeWidth={2}
      />
      <rect x={mid.x - 40} y={mid.y - 24} width={80} height={20} rx={4} className="fill-sky-500" />
      <text
        x={mid.x}
        y={mid.y - 10}
        textAnchor="middle"
        className="fill-white text-[10px] font-medium tabular-nums"
      >
        {length.toFixed(3).replace(".", ",")} m
      </text>
    </g>
  )
}

function PlanOverlay({
  viewport,
  onZoom,
  onFit,
  hint,
  draftPointCount,
  minimumPoints,
  onFinishDraft,
  onCancelDraft,
  showCancel,
}: {
  viewport: Viewport
  onZoom: (factor: number) => void
  onFit: () => void
  hint: string | null
  /** Antall punkter satt i pågående tegning, eller null når ingen pågår. */
  draftPointCount: number | null
  minimumPoints: number
  onFinishDraft: () => void
  onCancelDraft: () => void
  /** «Avbryt» hører bare hjemme når et verktøy faktisk er i gang. */
  showCancel: boolean
}) {
  const barMeters = pickScaleBar(viewport.scale)
  const drawing = draftPointCount !== null

  return (
    <>
      {hint && (
        <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 py-1 pl-3 pr-1 text-[11px] font-medium shadow-sm backdrop-blur">
          <span className="text-foreground">{hint}</span>
          {drawing ? (
            <>
              {/* Uten synlige knapper her må brukeren VITE at dobbeltklikk
                  eller Enter avslutter. Det er den vanligste grunnen til at
                  folk tror tegneverktøyet ikke virker. */}
              <button
                type="button"
                onClick={onFinishDraft}
                disabled={(draftPointCount ?? 0) < minimumPoints}
                className="rounded-full bg-primary px-2.5 py-1 text-primary-foreground disabled:opacity-40"
              >
                Ferdig
              </button>
              <button
                type="button"
                onClick={onCancelDraft}
                className="rounded-full px-2 py-1 text-muted-foreground hover:bg-accent"
              >
                Avbryt
              </button>
            </>
          ) : (
            showCancel && (
              <button
                type="button"
                onClick={onCancelDraft}
                className="rounded-full px-2 py-1 text-muted-foreground hover:bg-accent"
              >
                Avbryt
              </button>
            )
          )}
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex items-end gap-3">
        <div className="rounded-md border bg-background/90 px-2 py-1 backdrop-blur">
          <div
            className="h-1.5 border-x-2 border-b-2 border-foreground"
            style={{ width: barMeters * viewport.scale }}
          />
          <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">{barMeters} m</div>
        </div>
      </div>

      <div className="absolute bottom-3 right-3 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onZoom(1.25)}
          className="h-8 w-8 rounded-md border bg-background/90 text-sm font-medium backdrop-blur hover:bg-accent"
          aria-label="Zoom inn"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => onZoom(1 / 1.25)}
          className="h-8 w-8 rounded-md border bg-background/90 text-sm font-medium backdrop-blur hover:bg-accent"
          aria-label="Zoom ut"
        >
          −
        </button>
        <button
          type="button"
          onClick={onFit}
          className="h-8 w-8 rounded-md border bg-background/90 text-[10px] font-medium backdrop-blur hover:bg-accent"
          aria-label="Tilpass visningen"
        >
          Fit
        </button>
      </div>

      <div className="pointer-events-none absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border bg-background/90 text-[10px] font-semibold backdrop-blur">
        N↑
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

function nearestWall(storey: Storey | null, point: Point) {
  if (!storey) return null
  let best: { wall: Wall; distance: number } | null = null
  for (const wall of storey.walls) {
    const projection = closestPointOnSegment(point, wall.a, wall.b)
    if (!best || projection.distance < best.distance) {
      best = { wall, distance: projection.distance }
    }
  }
  if (!best || best.distance > Math.max(best.wall.thickness, 0.4)) return null
  return best
}

function doorSwingPath(
  start: Point,
  end: Point,
  normal: Point,
  toScreen: (point: Point) => { x: number; y: number }
) {
  const width = distance(start, end)
  const hinge = toScreen(start)
  const swingEnd = toScreen(add(start, scaleVec(normal, width)))
  const radius = width * Math.abs(toScreen({ x: 1, y: 0 }).x - toScreen({ x: 0, y: 0 }).x)
  const openLeaf = toScreen(end)

  return [
    `M ${openLeaf.x} ${openLeaf.y}`,
    `A ${radius} ${radius} 0 0 1 ${swingEnd.x} ${swingEnd.y}`,
    `L ${hinge.x} ${hinge.y}`,
  ].join(" ")
}

function pickGridStep(scale: number) {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20]
  for (const candidate of candidates) {
    if (candidate * scale >= 18) return candidate
  }
  return 20
}

function pickScaleBar(scale: number) {
  const candidates = [0.5, 1, 2, 5, 10, 20, 50]
  for (const candidate of candidates) {
    if (candidate * scale >= 60) return candidate
  }
  return 100
}
