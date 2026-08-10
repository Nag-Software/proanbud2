"use client"

/**
 * Innholdet i høyreklikk-menyen.
 *
 * Bygges ett sted, brukes både fra planen og 3D-scenen — ellers ville de to
 * visningene fått ulike hurtighandlinger på det samme elementet.
 */

import {
  Copy,
  DoorOpen,
  Layers,
  Lock,
  LockOpen,
  Map,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Square,
  Trash2,
  Triangle,
} from "lucide-react"

import type { CadMenuItem } from "@/components/cad/cad-context-menu"
import { projectOntoWall } from "@/lib/cad/geometry"
import type { CadStore } from "@/lib/cad/store"
import type { Point, SelectionRef, Storey } from "@/lib/cad/types"

export function buildCadMenuItems({
  store,
  storey,
  selection,
  worldPoint,
  onShowProperties,
  onAddFloorFromWalls,
  onAddRoofFromWalls,
}: {
  store: CadStore
  storey: Storey | null
  selection: SelectionRef | null
  /** Hvor i planet brukeren høyreklikket — brukes til å plassere nye åpninger. */
  worldPoint: Point | null
  onShowProperties: () => void
  onAddFloorFromWalls: () => void
  onAddRoofFromWalls: () => void
}): CadMenuItem[] {
  const items: CadMenuItem[] = []

  const rotateItems = (label = "Roter"): CadMenuItem[] => [
    {
      label: `${label} 90° mot venstre`,
      icon: RotateCcw,
      onSelect: () => store.rotateSelection(-90),
      separatorBefore: true,
    },
    {
      label: `${label} 90° mot høyre`,
      icon: RotateCw,
      onSelect: () => store.rotateSelection(90),
    },
  ]

  const propertiesItem: CadMenuItem = {
    label: "Egenskaper",
    icon: SlidersHorizontal,
    onSelect: onShowProperties,
    hint: "Åpne panelet med eksakte mål",
  }

  if (!selection || !storey) {
    // Tomt underlag: handlingene som gjelder hele etasjen.
    return [
      {
        label: "Gulv etter ytterveggene",
        icon: Map,
        onSelect: onAddFloorFromWalls,
      },
      {
        label: "Saltak etter ytterveggene",
        icon: Triangle,
        onSelect: onAddRoofFromWalls,
      },
      {
        label: "Roter etasjen 90° mot venstre",
        icon: RotateCcw,
        onSelect: () => store.rotateStorey(-90),
        separatorBefore: true,
      },
      {
        label: "Roter etasjen 90° mot høyre",
        icon: RotateCw,
        onSelect: () => store.rotateStorey(90),
      },
      {
        label: "Ny etasje (kopi av denne)",
        icon: Layers,
        onSelect: () => store.addStorey(true),
        separatorBefore: true,
      },
      { ...propertiesItem, separatorBefore: true },
    ]
  }

  if (selection.kind === "wall") {
    const wall = storey.walls.find((item) => item.id === selection.id)
    const at = wall && worldPoint ? projectOntoWall(wall, worldPoint) : null

    items.push(
      {
        label: "Sett inn dør her",
        icon: DoorOpen,
        disabled: at === null,
        onSelect: () => {
          if (!wall || at === null) return
          const id = store.addOpening(wall.id, "door", at)
          if (id) store.setSelection({ kind: "opening", id, wallId: wall.id, storeyId: storey.id })
        },
      },
      {
        label: "Sett inn vindu her",
        icon: Square,
        disabled: at === null,
        onSelect: () => {
          if (!wall || at === null) return
          const id = store.addOpening(wall.id, "window", at)
          if (id) store.setSelection({ kind: "opening", id, wallId: wall.id, storeyId: storey.id })
        },
      },
      {
        label: "Dupliser veggen",
        icon: Copy,
        separatorBefore: true,
        onSelect: () => {
          if (!wall) return
          // Legges 1 m ved siden av, slik at kopien er synlig og gripbar.
          const id = store.addWall(
            { x: wall.a.x + 1, y: wall.a.y + 1 },
            { x: wall.b.x + 1, y: wall.b.y + 1 },
            wall.type
          )
          if (id) store.setSelection({ kind: "wall", id, storeyId: storey.id })
        },
      },
      ...rotateItems("Roter veggen"),
      {
        label: wall?.locked ? "Lås opp" : "Lås veggen",
        icon: wall?.locked ? LockOpen : Lock,
        separatorBefore: true,
        onSelect: () => wall && store.updateWall(wall.id, { locked: !wall.locked }),
      }
    )
  }

  if (selection.kind === "opening") {
    const wall = storey.walls.find((item) => item.id === selection.wallId)
    const opening = wall?.openings.find((item) => item.id === selection.id)

    items.push(
      {
        label: opening?.kind === "door" ? "Gjør om til vindu" : "Gjør om til dør",
        icon: opening?.kind === "door" ? Square : DoorOpen,
        onSelect: () => {
          if (!wall || !opening) return
          const becomesDoor = opening.kind !== "door"
          store.updateOpening(wall.id, opening.id, {
            kind: becomesDoor ? "door" : "window",
            sill: becomesDoor ? 0 : 0.9,
          })
        },
      },
      {
        label: "Midtstill på veggen",
        onSelect: () => {
          if (!wall || !opening) return
          const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y)
          store.updateOpening(wall.id, opening.id, { distance: length / 2 })
        },
      }
    )
  }

  if (selection.kind === "slab" || selection.kind === "roof") {
    items.push(...rotateItems())
  }

  if (selection.kind === "space") {
    items.push({
      label: "Rommet følger veggene",
      onSelect: onShowProperties,
      hint: "Flytt en vegg for å endre rommet",
      disabled: true,
    })
  }

  if (selection.kind === "column") {
    items.push(...rotateItems("Roter søylen"))
  }

  items.push({ ...propertiesItem, separatorBefore: true })

  if (selection.kind !== "space") {
    items.push({
      label: "Slett",
      icon: Trash2,
      destructive: true,
      separatorBefore: true,
      onSelect: () => store.deleteSelection(),
    })
  }

  return items
}

export function describeSelectionForMenu(
  selection: SelectionRef | null,
  storey: Storey | null
): string {
  if (!selection || !storey) return "Etasjen"
  if (selection.kind === "wall") {
    const wall = storey.walls.find((item) => item.id === selection.id)
    return wall?.type === "exterior" ? "Yttervegg" : "Innervegg"
  }
  if (selection.kind === "opening") {
    const opening = storey.walls
      .flatMap((wall) => wall.openings)
      .find((item) => item.id === selection.id)
    return opening?.kind === "door" ? "Dør" : opening?.kind === "window" ? "Vindu" : "Åpning"
  }
  if (selection.kind === "slab") return "Dekke"
  if (selection.kind === "roof") return "Tak"
  if (selection.kind === "column") return "Søyle"
  if (selection.kind === "space") {
    return storey.spaces.find((item) => item.id === selection.id)?.name ?? "Rom"
  }
  return "Element"
}
