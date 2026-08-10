/**
 * DXF-eksport av plantegningen (AutoCAD R12 ASCII).
 *
 * R12 er den minste fellesnevneren: alt fra DDS-CAD og AutoCAD til gratis
 * visere leser den uten videre. Vi holder oss derfor til LINE, TEXT og
 * CIRCLE — ingen LWPOLYLINE (finnes ikke i R12) og ingen blokker.
 *
 * Én etasje = ett sett lag (VEGG_1ETG, APNING_1ETG, ROM_1ETG, TEKST_1ETG), slik
 * at mottakeren kan slå etasjene av og på hver for seg.
 */

import { computeWallFootprints, footprintPolygon } from "../geometry"
import { add, distance, normalize, perpendicular, polygonArea, polygonCentroid, scale, sub } from "../math"
import type { BuildingModel, Point } from "../types"

type DxfLayer = { name: string; color: number }

class DxfBuilder {
  private entities: string[] = []
  private layers = new Map<string, DxfLayer>()

  layer(name: string, color: number) {
    if (!this.layers.has(name)) this.layers.set(name, { name, color })
    return name
  }

  line(layer: string, from: Point, to: Point) {
    this.entities.push(
      [
        "0",
        "LINE",
        "8",
        layer,
        "10",
        format(from.x),
        "20",
        format(from.y),
        "30",
        "0.0",
        "11",
        format(to.x),
        "21",
        format(to.y),
        "31",
        "0.0",
      ].join("\n")
    )
  }

  polyline(layer: string, points: Point[], close = true) {
    for (let i = 0; i < points.length - (close ? 0 : 1); i++) {
      const from = points[i]
      const to = points[(i + 1) % points.length]
      this.line(layer, from, to)
    }
  }

  text(layer: string, position: Point, height: number, value: string) {
    this.entities.push(
      [
        "0",
        "TEXT",
        "8",
        layer,
        "10",
        format(position.x),
        "20",
        format(position.y),
        "30",
        "0.0",
        "40",
        format(height),
        "1",
        value.replace(/\n/g, " "),
        "72",
        "1",
        "11",
        format(position.x),
        "21",
        format(position.y),
        "31",
        "0.0",
      ].join("\n")
    )
  }

  circle(layer: string, center: Point, radius: number) {
    this.entities.push(
      [
        "0",
        "CIRCLE",
        "8",
        layer,
        "10",
        format(center.x),
        "20",
        format(center.y),
        "30",
        "0.0",
        "40",
        format(radius),
      ].join("\n")
    )
  }

  toString() {
    const layerTable: string[] = []
    for (const layer of this.layers.values()) {
      layerTable.push(
        ["0", "LAYER", "2", layer.name, "70", "0", "62", String(layer.color), "6", "CONTINUOUS"].join("\n")
      )
    }

    return [
      "0\nSECTION",
      "2\nHEADER",
      "9\n$ACADVER\n1\nAC1009",
      "9\n$INSUNITS\n70\n6", // 6 = meter
      "0\nENDSEC",
      "0\nSECTION",
      "2\nTABLES",
      "0\nTABLE",
      "2\nLAYER",
      `70\n${this.layers.size}`,
      ...layerTable,
      "0\nENDTAB",
      "0\nENDSEC",
      "0\nSECTION",
      "2\nENTITIES",
      ...this.entities,
      "0\nENDSEC",
      "0\nEOF",
      "",
    ].join("\n")
  }
}

function format(value: number) {
  return (Math.round(value * 1e6) / 1e6).toFixed(6)
}

function safeLayerName(value: string) {
  // DXF R12-lagnavn tåler ikke mellomrom, æøå eller punktum.
  return value
    .toUpperCase()
    .replace(/Æ/g, "AE")
    .replace(/Ø/g, "OE")
    .replace(/Å/g, "AA")
    .replace(/[^A-Z0-9_-]/g, "_")
    .slice(0, 30)
}

export function exportModelToDxf(model: BuildingModel) {
  const dxf = new DxfBuilder()

  model.storeys.forEach((storey, index) => {
    const suffix = safeLayerName(storey.name || `ETG${index + 1}`)
    const wallLayer = dxf.layer(`VEGG_${suffix}`, 7)
    const openingLayer = dxf.layer(`APNING_${suffix}`, 5)
    const roomLayer = dxf.layer(`ROM_${suffix}`, 3)
    const textLayer = dxf.layer(`TEKST_${suffix}`, 2)

    const footprints = computeWallFootprints(storey.walls)

    for (const wall of storey.walls) {
      const footprint = footprints.get(wall.id)
      if (!footprint) continue

      dxf.polyline(wallLayer, footprintPolygon(footprint))

      const direction = normalize(sub(wall.b, wall.a))
      const normal = perpendicular(direction)
      const half = wall.thickness / 2

      for (const opening of wall.openings) {
        const start = add(wall.a, scale(direction, opening.distance - opening.width / 2))
        const end = add(wall.a, scale(direction, opening.distance + opening.width / 2))

        // Åpningen tegnes som to tverrstreker gjennom veggen + selve karmlinja.
        for (const point of [start, end]) {
          dxf.line(
            openingLayer,
            add(point, scale(normal, half)),
            add(point, scale(normal, -half))
          )
        }
        dxf.line(openingLayer, start, end)

        if (opening.kind === "door") {
          // Dørslag som en kvartsirkel-markering (forenklet: full sirkel i R12).
          dxf.circle(openingLayer, start, Math.min(opening.width, 1.2))
        }
      }
    }

    for (const space of storey.spaces) {
      if (space.outline.length < 3) continue
      dxf.polyline(roomLayer, space.outline)
      const center = polygonCentroid(space.outline)
      const area = polygonArea(space.outline)
      dxf.text(textLayer, center, 0.25, space.name)
      dxf.text(
        textLayer,
        { x: center.x, y: center.y - 0.35 },
        0.18,
        `${area.toFixed(1).replace(".", ",")} m2`
      )
    }

    for (const slab of storey.slabs) {
      if (slab.outline.length < 3) continue
      dxf.polyline(dxf.layer(`DEKKE_${suffix}`, 8), slab.outline)
    }

    for (const roof of storey.roofs) {
      if (roof.outline.length < 3) continue
      dxf.polyline(dxf.layer(`TAK_${suffix}`, 1), roof.outline)
    }

    // Målsetting av yttervegger: lengden skrevet midt på veggen.
    for (const wall of storey.walls) {
      if (wall.type !== "exterior") continue
      const length = distance(wall.a, wall.b)
      if (length < 0.5) continue
      const mid = scale(add(wall.a, wall.b), 0.5)
      dxf.text(textLayer, mid, 0.16, `${Math.round(length * 1000)}`)
    }
  })

  return dxf.toString()
}
