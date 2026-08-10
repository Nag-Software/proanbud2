"use client"

/**
 * Redigeringstilstand for CAD-editoren.
 *
 * Bevisste valg:
 *  - Ett lager utenfor React (useSyncExternalStore) i stedet for useState:
 *    plantegningen og 3D-scenen leser samme modell, og under drag oppdateres
 *    den mange ganger i sekundet. Med state løftet i en forelder ville hele
 *    treet blitt gjenskapt for hver musebevegelse.
 *  - Angre-stakken lagrer hele modellen. Modellen er små-JSON (titalls kB), og
 *    verdien av at angre ALLTID virker — også på tvers av romdeteksjon og
 *    normalisering — er større enn minnegevinsten ved delta-lagring.
 *  - `transient`-oppdateringer under drag hopper over romdeteksjon og
 *    historikk. Ett drag = én angre-post, ikke hundre.
 */

import { useCallback, useSyncExternalStore } from "react"

import {
  add,
  closestPointOnSegment,
  degToRad,
  distance,
  dot,
  normalize,
  perpendicular,
  polygonCentroid,
  rotate,
  roundMm,
  scale,
  snapPointToGrid,
  sub,
} from "./math"
import { DEFAULTS, WALL_TYPE_THICKNESS, defaultOpeningSize, newId, storeyName } from "./presets"
import { syncSpaces } from "./rooms"
import { createEmptyStorey, sanitizeModel } from "./schema"
import type {
  BuildingModel,
  CadMaterial,
  Column,
  Opening,
  OpeningKind,
  Point,
  Roof,
  SelectionRef,
  Slab,
  Storey,
  Wall,
  WallType,
} from "./types"

export type CadTool =
  | "select"
  | "wall"
  | "door"
  | "window"
  | "opening"
  | "slab"
  | "roof"
  | "column"
  | "measure"

export type CadViewMode = "2d" | "3d" | "split"

/**
 * Elementtypene som eier sitt eget omriss.
 *
 * Rom står bevisst IKKE her: de utledes av veggene. Kunne man dra i et
 * romomriss, ville rommet slutte å stemme med veggene rundt — og neste
 * veggendring ville lagt et nytt, automatisk rom oppå det redigerte.
 */
export type OutlineKind = "slab" | "roof"

export type CadState = {
  model: BuildingModel
  activeStoreyId: string
  selection: SelectionRef | null
  tool: CadTool
  view: CadViewMode
  showGrid: boolean
  showRooms: boolean
  showDimensions: boolean
  /** Vis alle etasjer i 3D, ikke bare den aktive. */
  showAllStoreys: boolean
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
}

const MAX_HISTORY = 80
/** Hvor nær en veggs senterlinje et endepunkt må ligge for å regnes som T-skjøt. */
const TEE_TOLERANCE = 0.01

export class CadStore {
  private state: CadState
  private listeners = new Set<() => void>()
  private undoStack: BuildingModel[] = []
  private redoStack: BuildingModel[] = []
  private transientBaseline: BuildingModel | null = null

  constructor(model: BuildingModel) {
    this.state = {
      model,
      activeStoreyId: model.storeys[0]?.id ?? "",
      selection: null,
      tool: "select",
      view: "split",
      showGrid: true,
      showRooms: true,
      showDimensions: true,
      showAllStoreys: false,
      dirty: false,
      canUndo: false,
      canRedo: false,
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  private emit() {
    for (const listener of this.listeners) listener()
  }

  private setState(patch: Partial<CadState>) {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  // -------------------------------------------------------------------------
  // Modellendringer
  // -------------------------------------------------------------------------

  /**
   * @param options.transient  Under pågående drag: ingen historikk, ingen
   *                           romdeteksjon. Avslutt med `commitTransient()`.
   * @param options.skipRooms  For endringer som ikke rører veggeometrien.
   */
  update(
    mutator: (model: BuildingModel) => BuildingModel,
    options: { transient?: boolean; skipRooms?: boolean } = {}
  ) {
    const previous = this.state.model

    if (options.transient && !this.transientBaseline) {
      this.transientBaseline = previous
    }

    let next = mutator(previous)
    if (next === previous) return

    if (!options.transient) {
      next = sanitizeModel(next)
    }
    if (!options.skipRooms && !options.transient) {
      next = withSyncedSpaces(next)
    }

    if (!options.transient) {
      this.pushHistory(this.transientBaseline ?? previous)
      this.transientBaseline = null
    }

    this.setState({
      model: next,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    })
  }

  /** Avslutter et drag: normaliserer, oppdaterer rom og lagrer ÉN angre-post. */
  commitTransient() {
    if (!this.transientBaseline) return
    const baseline = this.transientBaseline
    this.transientBaseline = null

    const next = withSyncedSpaces(sanitizeModel(this.state.model))
    this.pushHistory(baseline)
    this.setState({
      model: next,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    })
  }

  cancelTransient() {
    if (!this.transientBaseline) return
    const baseline = this.transientBaseline
    this.transientBaseline = null
    this.setState({ model: baseline })
  }

  private pushHistory(model: BuildingModel) {
    this.undoStack.push(model)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  undo() {
    const previous = this.undoStack.pop()
    if (!previous) return
    this.redoStack.push(this.state.model)
    this.setState({
      model: previous,
      selection: null,
      dirty: true,
      canUndo: this.undoStack.length > 0,
      canRedo: true,
    })
  }

  redo() {
    const next = this.redoStack.pop()
    if (!next) return
    this.undoStack.push(this.state.model)
    this.setState({
      model: next,
      selection: null,
      dirty: true,
      canUndo: true,
      canRedo: this.redoStack.length > 0,
    })
  }

  markSaved(model?: BuildingModel) {
    this.setState({ dirty: false, ...(model ? { model } : {}) })
  }

  replaceModel(model: BuildingModel, options: { markDirty?: boolean } = {}) {
    this.pushHistory(this.state.model)
    const next = withSyncedSpaces(sanitizeModel(model))
    this.setState({
      model: next,
      activeStoreyId: next.storeys.some((storey) => storey.id === this.state.activeStoreyId)
        ? this.state.activeStoreyId
        : next.storeys[0]?.id ?? "",
      selection: null,
      dirty: options.markDirty ?? true,
      canUndo: true,
      canRedo: false,
    })
  }

  // -------------------------------------------------------------------------
  // UI-tilstand
  // -------------------------------------------------------------------------

  setTool(tool: CadTool) {
    this.setState({ tool, selection: tool === "select" ? this.state.selection : null })
  }

  setView(view: CadViewMode) {
    this.setState({ view })
  }

  setSelection(selection: SelectionRef | null) {
    this.setState({ selection })
  }

  setActiveStorey(storeyId: string) {
    this.setState({ activeStoreyId: storeyId, selection: null })
  }

  toggle(key: "showGrid" | "showRooms" | "showDimensions" | "showAllStoreys") {
    this.setState({ [key]: !this.state[key] } as Partial<CadState>)
  }

  // -------------------------------------------------------------------------
  // Avledet
  // -------------------------------------------------------------------------

  get activeStorey(): Storey | null {
    return (
      this.state.model.storeys.find((storey) => storey.id === this.state.activeStoreyId) ??
      this.state.model.storeys[0] ??
      null
    )
  }

  snap(point: Point, useGrid = true): Point {
    if (!useGrid) return { x: roundMm(point.x), y: roundMm(point.y) }
    return snapPointToGrid(point, this.state.model.meta.gridSize || DEFAULTS.gridSize)
  }

  // -------------------------------------------------------------------------
  // Elementoperasjoner
  // -------------------------------------------------------------------------

  private mapActiveStorey(mutator: (storey: Storey) => Storey) {
    return (model: BuildingModel): BuildingModel => ({
      ...model,
      storeys: model.storeys.map((storey) =>
        storey.id === this.state.activeStoreyId ? mutator(storey) : storey
      ),
    })
  }

  addWall(a: Point, b: Point, type: WallType = "exterior") {
    const storey = this.activeStorey
    if (!storey) return null
    const wall: Wall = {
      id: newId("w"),
      a,
      b,
      thickness: WALL_TYPE_THICKNESS[type],
      height: storey.height,
      baseOffset: 0,
      type,
      openings: [],
      materialId: null,
      exteriorMaterialId: null,
      interiorMaterialId: null,
      label: null,
    }
    this.update(this.mapActiveStorey((current) => ({ ...current, walls: [...current.walls, wall] })))
    return wall.id
  }

  updateWall(wallId: string, patch: Partial<Wall>, options: { transient?: boolean } = {}) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        walls: storey.walls.map((wall) => (wall.id === wallId ? { ...wall, ...patch } : wall)),
      })),
      options
    )
  }

  /**
   * Flytter hele veggen, og holder naboene festet.
   *
   * To slags naboer må følge med, ellers rakner planet:
   *  - HJØRNE: en vegg som deler endepunkt flytter endepunktet sitt likt.
   *  - T-SKJØT: en vegg som ender MIDT PÅ den vi flytter (typisk en skillevegg
   *    inn i ytterveggen) følger etter vinkelrett på veggen. Bare den
   *    vinkelrette delen av bevegelsen — drar du veggen langsetter seg selv,
   *    skal skilleveggen bli stående der den står.
   */
  moveWall(wallId: string, delta: Point, options: { transient?: boolean } = {}) {
    this.update(
      this.mapActiveStorey((storey) => {
        const target = storey.walls.find((wall) => wall.id === wallId)
        if (!target) return storey

        const movedA = { x: target.a.x + delta.x, y: target.a.y + delta.y }
        const movedB = { x: target.b.x + delta.x, y: target.b.y + delta.y }

        const direction = normalize(sub(target.b, target.a))
        const normal = perpendicular(direction)
        const perpendicularDelta = scale(normal, dot(delta, normal))

        const followsAsTeeJoint = (point: Point) => {
          if (samePoint(point, target.a) || samePoint(point, target.b)) return false
          const projection = closestPointOnSegment(point, target.a, target.b)
          if (projection.distance > TEE_TOLERANCE) return false
          const along = projection.t * distance(target.a, target.b)
          const fromEnd = distance(target.a, target.b) - along
          return along > TEE_TOLERANCE && fromEnd > TEE_TOLERANCE
        }

        return {
          ...storey,
          walls: storey.walls.map((wall) => {
            if (wall.id === wallId) return { ...wall, a: movedA, b: movedB }

            const next = { ...wall }
            if (samePoint(wall.a, target.a)) next.a = movedA
            else if (samePoint(wall.a, target.b)) next.a = movedB
            else if (followsAsTeeJoint(wall.a)) next.a = add(wall.a, perpendicularDelta)

            if (samePoint(wall.b, target.a)) next.b = movedA
            else if (samePoint(wall.b, target.b)) next.b = movedB
            else if (followsAsTeeJoint(wall.b)) next.b = add(wall.b, perpendicularDelta)

            return next
          }),
        }
      }),
      options
    )
  }

  /** Flytter ett endepunkt — og alle vegger som deler det punktet. */
  moveWallEndpoint(
    wallId: string,
    end: "a" | "b",
    position: Point,
    options: { transient?: boolean } = {}
  ) {
    this.update(
      this.mapActiveStorey((storey) => {
        const target = storey.walls.find((wall) => wall.id === wallId)
        if (!target) return storey
        const origin = end === "a" ? target.a : target.b

        return {
          ...storey,
          walls: storey.walls.map((wall) => {
            const next = { ...wall }
            if (samePoint(wall.a, origin)) next.a = position
            if (samePoint(wall.b, origin)) next.b = position
            return next
          }),
        }
      }),
      options
    )
  }

  deleteWall(wallId: string) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        walls: storey.walls.filter((wall) => wall.id !== wallId),
      }))
    )
    this.setSelection(null)
  }

  addOpening(wallId: string, kind: OpeningKind, distance: number) {
    const size = defaultOpeningSize(kind)
    const opening: Opening = {
      id: newId("op"),
      kind,
      distance,
      width: size.width,
      height: size.height,
      sill: size.sill,
      label: null,
      materialId: null,
    }
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        walls: storey.walls.map((wall) =>
          wall.id === wallId ? { ...wall, openings: [...wall.openings, opening] } : wall
        ),
      })),
      { skipRooms: true }
    )
    return opening.id
  }

  updateOpening(
    wallId: string,
    openingId: string,
    patch: Partial<Opening>,
    options: { transient?: boolean } = {}
  ) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        walls: storey.walls.map((wall) =>
          wall.id === wallId
            ? {
                ...wall,
                openings: wall.openings.map((opening) =>
                  opening.id === openingId ? { ...opening, ...patch } : opening
                ),
              }
            : wall
        ),
      })),
      { ...options, skipRooms: true }
    )
  }

  deleteOpening(wallId: string, openingId: string) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        walls: storey.walls.map((wall) =>
          wall.id === wallId
            ? { ...wall, openings: wall.openings.filter((opening) => opening.id !== openingId) }
            : wall
        ),
      })),
      { skipRooms: true }
    )
    this.setSelection(null)
  }

  addSlab(outline: Point[], kind: Slab["kind"] = "floor") {
    const slab: Slab = {
      id: newId("sl"),
      kind,
      outline,
      thickness: DEFAULTS.slabThickness,
      offset: 0,
      materialId: null,
      label: null,
    }
    this.update(this.mapActiveStorey((storey) => ({ ...storey, slabs: [...storey.slabs, slab] })), {
      skipRooms: true,
    })
    return slab.id
  }

  updateSlab(slabId: string, patch: Partial<Slab>) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        slabs: storey.slabs.map((slab) => (slab.id === slabId ? { ...slab, ...patch } : slab)),
      })),
      { skipRooms: true }
    )
  }

  deleteSlab(slabId: string) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        slabs: storey.slabs.filter((slab) => slab.id !== slabId),
      })),
      { skipRooms: true }
    )
    this.setSelection(null)
  }

  addRoof(outline: Point[], kind: Roof["kind"] = "gable") {
    const storey = this.activeStorey
    const roof: Roof = {
      id: newId("rf"),
      kind,
      outline,
      baseHeight: storey?.height ?? DEFAULTS.storeyHeight,
      pitchDeg: kind === "flat" ? 0 : DEFAULTS.roofPitchDeg,
      directionDeg: 0,
      thickness: DEFAULTS.roofThickness,
      overhang: DEFAULTS.roofOverhang,
      materialId: null,
      label: null,
    }
    this.update(this.mapActiveStorey((current) => ({ ...current, roofs: [...current.roofs, roof] })), {
      skipRooms: true,
    })
    return roof.id
  }

  updateRoof(roofId: string, patch: Partial<Roof>) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        roofs: storey.roofs.map((roof) => (roof.id === roofId ? { ...roof, ...patch } : roof)),
      })),
      { skipRooms: true }
    )
  }

  deleteRoof(roofId: string) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        roofs: storey.roofs.filter((roof) => roof.id !== roofId),
      })),
      { skipRooms: true }
    )
    this.setSelection(null)
  }

  addColumn(position: Point) {
    const storey = this.activeStorey
    const column: Column = {
      id: newId("col"),
      position,
      width: DEFAULTS.columnSize,
      depth: DEFAULTS.columnSize,
      height: storey?.height ?? DEFAULTS.storeyHeight,
      baseOffset: 0,
      rotationDeg: 0,
      materialId: null,
      label: null,
    }
    this.update(
      this.mapActiveStorey((current) => ({ ...current, columns: [...current.columns, column] })),
      { skipRooms: true }
    )
    return column.id
  }

  updateColumn(columnId: string, patch: Partial<Column>, options: { transient?: boolean } = {}) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        columns: storey.columns.map((column) =>
          column.id === columnId ? { ...column, ...patch } : column
        ),
      })),
      { ...options, skipRooms: true }
    )
  }

  deleteColumn(columnId: string) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        columns: storey.columns.filter((column) => column.id !== columnId),
      })),
      { skipRooms: true }
    )
    this.setSelection(null)
  }

  updateSpace(spaceId: string, patch: Partial<Storey["spaces"][number]>) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        spaces: storey.spaces.map((space) =>
          space.id === spaceId ? { ...space, ...patch } : space
        ),
      })),
      { skipRooms: true }
    )
  }

  deleteSelection() {
    const selection = this.state.selection
    if (!selection) return
    if (selection.kind === "wall") this.deleteWall(selection.id)
    else if (selection.kind === "opening") this.deleteOpening(selection.wallId, selection.id)
    else if (selection.kind === "slab") this.deleteSlab(selection.id)
    else if (selection.kind === "roof") this.deleteRoof(selection.id)
    else if (selection.kind === "column") this.deleteColumn(selection.id)
  }

  // -------------------------------------------------------------------------
  // Omriss: hjørner og kanter
  // -------------------------------------------------------------------------

  /**
   * Felles redigering av omrisset til dekker, tak og rom.
   *
   * Uten dette kunne bare veggendepunkter dras — et tak kunne opprettes, men
   * aldri strekkes. Nå er hvert hjørne og hver kant et gripepunkt, slik at et
   * takutstikk kan trekkes ut i én retning uten å røre resten.
   */
  private mapOutline(
    kind: OutlineKind,
    id: string,
    mutator: (outline: Point[]) => Point[],
    options: { transient?: boolean } = {}
  ) {
    this.update(
      this.mapActiveStorey((storey) => {
        if (kind === "slab") {
          return {
            ...storey,
            slabs: storey.slabs.map((slab) =>
              slab.id === id ? { ...slab, outline: mutator(slab.outline) } : slab
            ),
          }
        }
        return {
          ...storey,
          roofs: storey.roofs.map((roof) =>
            roof.id === id ? { ...roof, outline: mutator(roof.outline) } : roof
          ),
        }
      }),
      { ...options, skipRooms: true }
    )
  }

  moveOutlinePoint(
    kind: OutlineKind,
    id: string,
    index: number,
    position: Point,
    options: { transient?: boolean } = {}
  ) {
    this.mapOutline(
      kind,
      id,
      (outline) => outline.map((point, i) => (i === index ? position : point)),
      options
    )
  }

  /** Flytter én kant sidelengs — kanten beholder retningen sin. */
  moveOutlineEdge(
    kind: OutlineKind,
    id: string,
    index: number,
    delta: Point,
    options: { transient?: boolean } = {}
  ) {
    this.mapOutline(
      kind,
      id,
      (outline) => {
        const next = outline.length
        return outline.map((point, i) =>
          i === index || i === (index + 1) % next
            ? { x: point.x + delta.x, y: point.y + delta.y }
            : point
        )
      },
      options
    )
  }

  /** Setter inn et nytt hjørne midt på kanten som starter i `index`. */
  insertOutlinePoint(kind: OutlineKind, id: string, index: number) {
    this.mapOutline(kind, id, (outline) => {
      if (outline.length < 2) return outline
      const from = outline[index]
      const to = outline[(index + 1) % outline.length]
      const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
      const next = [...outline]
      next.splice(index + 1, 0, middle)
      return next
    })
  }

  removeOutlinePoint(kind: OutlineKind, id: string, index: number) {
    this.mapOutline(kind, id, (outline) => {
      // Under tre hjørner er det ikke en flate lenger.
      if (outline.length <= 3) return outline
      return outline.filter((_, i) => i !== index)
    })
  }

  // -------------------------------------------------------------------------
  // Rotering
  // -------------------------------------------------------------------------

  /**
   * Setter veggens retning i grader, med STARTPUNKTET som pivot.
   *
   * Å rotere om midtpunktet ville flyttet begge endene, og brukeren mister
   * hjørnet han nettopp festet. Med start som pivot blir «vri veggen litt» en
   * forutsigbar operasjon.
   */
  setWallAngle(wallId: string, degrees: number) {
    this.update(
      this.mapActiveStorey((storey) => ({
        ...storey,
        walls: storey.walls.map((wall) => {
          if (wall.id !== wallId) return wall
          const length = distance(wall.a, wall.b)
          const radians = degToRad(degrees)
          return {
            ...wall,
            b: {
              x: wall.a.x + Math.cos(radians) * length,
              y: wall.a.y + Math.sin(radians) * length,
            },
          }
        }),
      }))
    )
  }

  /** Roterer det valgte elementet om sitt eget tyngdepunkt. */
  rotateSelection(degrees: number) {
    const selection = this.state.selection
    if (!selection) return
    const radians = degToRad(degrees)

    if (selection.kind === "wall") {
      const wall = this.activeStorey?.walls.find((item) => item.id === selection.id)
      if (!wall) return
      const pivot = scale(add(wall.a, wall.b), 0.5)
      this.updateWall(selection.id, {
        a: rotate(wall.a, radians, pivot),
        b: rotate(wall.b, radians, pivot),
      })
      return
    }

    if (selection.kind === "column") {
      const column = this.activeStorey?.columns.find((item) => item.id === selection.id)
      if (!column) return
      this.updateColumn(selection.id, { rotationDeg: column.rotationDeg + degrees })
      return
    }

    const rotateOutline = (outline: Point[]) => {
      const pivot = polygonCentroid(outline)
      return outline.map((point) => rotate(point, radians, pivot))
    }

    if (selection.kind === "slab") {
      const slab = this.activeStorey?.slabs.find((item) => item.id === selection.id)
      if (slab) this.updateSlab(selection.id, { outline: rotateOutline(slab.outline) })
      return
    }

    if (selection.kind === "roof") {
      const roof = this.activeStorey?.roofs.find((item) => item.id === selection.id)
      if (!roof) return
      // Taket roterer med omrisset, ellers ville mønet blitt stående igjen.
      this.updateRoof(selection.id, {
        outline: rotateOutline(roof.outline),
        directionDeg: roof.directionDeg + degrees,
      })
    }
  }

  /**
   * Roterer HELE etasjen om sitt eget senter. Dette er det man trenger når
   * KI-en har lagt bygget feil vei mot tomta, eller når planet skal rettes inn
   * mot nord.
   */
  rotateStorey(degrees: number, storeyId?: string) {
    const targetId = storeyId ?? this.state.activeStoreyId
    const radians = degToRad(degrees)

    this.update((model) => ({
      ...model,
      storeys: model.storeys.map((storey) => {
        if (storey.id !== targetId) return storey

        const points: Point[] = []
        for (const wall of storey.walls) points.push(wall.a, wall.b)
        for (const slab of storey.slabs) points.push(...slab.outline)
        for (const roof of storey.roofs) points.push(...roof.outline)
        for (const column of storey.columns) points.push(column.position)
        if (points.length === 0) return storey

        const xs = points.map((point) => point.x)
        const ys = points.map((point) => point.y)
        const pivot = {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        }
        const turn = (point: Point) => rotate(point, radians, pivot)

        return {
          ...storey,
          walls: storey.walls.map((wall) => ({ ...wall, a: turn(wall.a), b: turn(wall.b) })),
          slabs: storey.slabs.map((slab) => ({ ...slab, outline: slab.outline.map(turn) })),
          roofs: storey.roofs.map((roof) => ({
            ...roof,
            outline: roof.outline.map(turn),
            directionDeg: roof.directionDeg + degrees,
          })),
          columns: storey.columns.map((column) => ({
            ...column,
            position: turn(column.position),
            rotationDeg: column.rotationDeg + degrees,
          })),
          spaces: storey.spaces.map((space) => ({ ...space, outline: space.outline.map(turn) })),
        }
      }),
    }))
  }

  /**
   * Legger inn et ferdig rektangel med yttervegger. Den raskeste veien fra tom
   * tegning til noe å jobbe videre på — de fleste bygg starter som en boks.
   */
  addRectangle(width: number, depth: number, options: { withFloor?: boolean } = {}) {
    const storey = this.activeStorey
    if (!storey) return
    const safeWidth = Math.max(width, 0.5)
    const safeDepth = Math.max(depth, 0.5)

    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: safeWidth, y: 0 },
      { x: safeWidth, y: safeDepth },
      { x: 0, y: safeDepth },
    ]

    const walls: Wall[] = corners.map((corner, index) => ({
      id: newId("w"),
      a: corner,
      b: corners[(index + 1) % corners.length],
      thickness: WALL_TYPE_THICKNESS.exterior,
      height: storey.height,
      baseOffset: 0,
      type: "exterior",
      openings: [],
      materialId: null,
      exteriorMaterialId: null,
      interiorMaterialId: null,
      label: null,
    }))

    const slabs: Slab[] = options.withFloor
      ? [
          {
            id: newId("sl"),
            kind: "foundation",
            outline: corners,
            thickness: DEFAULTS.slabThickness,
            offset: 0,
            materialId: null,
            label: null,
          },
        ]
      : []

    this.update(
      this.mapActiveStorey((current) => ({
        ...current,
        walls: [...current.walls, ...walls],
        slabs: [...current.slabs, ...slabs],
      }))
    )
  }

  // -------------------------------------------------------------------------
  // Etasjer
  // -------------------------------------------------------------------------

  addStorey(copyFromActive = true) {
    const model = this.state.model
    const source = this.activeStorey
    const index = model.storeys.length
    const elevation = source ? source.elevation + source.height : 0
    const created = createEmptyStorey(index, elevation)

    if (copyFromActive && source) {
      // Kopier bæresystemet oppover — det er nesten alltid utgangspunktet for
      // neste etasje, og langt raskere enn å tegne på nytt.
      created.walls = source.walls.map((wall) => ({
        ...wall,
        id: newId("w"),
        openings: wall.openings.map((opening) => ({ ...opening, id: newId("op") })),
      }))
      created.height = source.height
    }

    this.update((current) => ({ ...current, storeys: [...current.storeys, created] }))
    this.setActiveStorey(created.id)
    return created.id
  }

  updateStorey(storeyId: string, patch: Partial<Storey>) {
    this.update((model) => ({
      ...model,
      storeys: model.storeys.map((storey) =>
        storey.id === storeyId ? { ...storey, ...patch } : storey
      ),
    }))
  }

  deleteStorey(storeyId: string) {
    const model = this.state.model
    if (model.storeys.length <= 1) return
    this.update((current) => ({
      ...current,
      storeys: current.storeys
        .filter((storey) => storey.id !== storeyId)
        .map((storey, index) => ({ ...storey, name: storey.name || storeyName(index) })),
    }))
    if (this.state.activeStoreyId === storeyId) {
      this.setActiveStorey(this.state.model.storeys[0]?.id ?? "")
    }
  }

  // -------------------------------------------------------------------------
  // Materialer
  // -------------------------------------------------------------------------

  addMaterial(material: Omit<CadMaterial, "id">) {
    const created: CadMaterial = { ...material, id: newId("mat") }
    this.update((model) => ({ ...model, materials: [...model.materials, created] }), {
      skipRooms: true,
    })
    return created.id
  }

  updateMaterial(materialId: string, patch: Partial<CadMaterial>) {
    this.update(
      (model) => ({
        ...model,
        materials: model.materials.map((material) =>
          material.id === materialId ? { ...material, ...patch } : material
        ),
      }),
      { skipRooms: true }
    )
  }

  deleteMaterial(materialId: string) {
    this.update(
      (model) => ({
        ...model,
        materials: model.materials.filter((material) => material.id !== materialId),
        storeys: model.storeys.map((storey) => ({
          ...storey,
          walls: storey.walls.map((wall) => ({
            ...wall,
            materialId: wall.materialId === materialId ? null : wall.materialId,
            exteriorMaterialId:
              wall.exteriorMaterialId === materialId ? null : wall.exteriorMaterialId,
            interiorMaterialId:
              wall.interiorMaterialId === materialId ? null : wall.interiorMaterialId,
            openings: wall.openings.map((opening) => ({
              ...opening,
              materialId: opening.materialId === materialId ? null : opening.materialId,
            })),
          })),
          slabs: storey.slabs.map((slab) => ({
            ...slab,
            materialId: slab.materialId === materialId ? null : slab.materialId,
          })),
          roofs: storey.roofs.map((roof) => ({
            ...roof,
            materialId: roof.materialId === materialId ? null : roof.materialId,
          })),
          spaces: storey.spaces.map((space) => ({
            ...space,
            floorMaterialId: space.floorMaterialId === materialId ? null : space.floorMaterialId,
            wallMaterialId: space.wallMaterialId === materialId ? null : space.wallMaterialId,
            ceilingMaterialId:
              space.ceilingMaterialId === materialId ? null : space.ceilingMaterialId,
          })),
        })),
      }),
      { skipRooms: true }
    )
  }

  /** Tilordner et materiale til det som er valgt akkurat nå. */
  assignMaterialToSelection(materialId: string | null, slot: MaterialSlot = "main") {
    const selection = this.state.selection
    if (!selection) return

    if (selection.kind === "wall") {
      const key =
        slot === "exterior"
          ? "exteriorMaterialId"
          : slot === "interior"
            ? "interiorMaterialId"
            : "materialId"
      this.updateWall(selection.id, { [key]: materialId } as Partial<Wall>)
      return
    }
    if (selection.kind === "opening") {
      this.updateOpening(selection.wallId, selection.id, { materialId })
      return
    }
    if (selection.kind === "slab") {
      this.updateSlab(selection.id, { materialId })
      return
    }
    if (selection.kind === "roof") {
      this.updateRoof(selection.id, { materialId })
      return
    }
    if (selection.kind === "column") {
      this.updateColumn(selection.id, { materialId })
      return
    }
    if (selection.kind === "space") {
      const key =
        slot === "ceiling"
          ? "ceilingMaterialId"
          : slot === "interior"
            ? "wallMaterialId"
            : "floorMaterialId"
      this.updateSpace(selection.id, { [key]: materialId })
    }
  }
}

export type MaterialSlot = "main" | "exterior" | "interior" | "ceiling"

function samePoint(a: Point, b: Point) {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

function withSyncedSpaces(model: BuildingModel): BuildingModel {
  return {
    ...model,
    storeys: model.storeys.map((storey) => ({
      ...storey,
      spaces: syncSpaces(storey.walls, storey.spaces),
    })),
  }
}

// ---------------------------------------------------------------------------
// React-binding
// ---------------------------------------------------------------------------

export function useCadState(store: CadStore): CadState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

export function useActiveStorey(store: CadStore): Storey | null {
  const state = useCadState(store)
  return (
    state.model.storeys.find((storey) => storey.id === state.activeStoreyId) ??
    state.model.storeys[0] ??
    null
  )
}

export function useCadCallback<Args extends unknown[]>(
  store: CadStore,
  fn: (store: CadStore, ...args: Args) => void
) {
  return useCallback((...args: Args) => fn(store, ...args), [store, fn])
}
