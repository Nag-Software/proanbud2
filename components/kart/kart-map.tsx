"use client"

import { useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { useTheme } from "next-themes"

import { geoJsonCircle } from "@/lib/geo/circle"
import type { KartCustomer, KartGeofence, KartTrip } from "@/app/kart/actions"

type FenceGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
type FenceFeature = { type: "Feature"; properties: Record<string, unknown>; geometry: FenceGeometry }

// Apple-Maps-like operations map. Project pins are HTML markers (so they can
// carry live crew/avvik badges) synced to an unclustered GeoJSON source — dense
// areas collapse into cluster bubbles, individual pins keep their badges. Plus an
// optional value heatmap, customer pins, geofences, and kjørebok routes, over a
// street/satellite/hybrid MapTiler basemap. maplibre-gl touches `window`, so load
// this via next/dynamic with ssr:false.

export type Basemap = "standard" | "satellite" | "hybrid"

// Live geofence-edit state: a draggable circle (center + radius) previewed on the
// map. null = not editing.
export type GeoEdit = { center: { lat: number; lng: number }; radiusM: number }

// Minimal project shape the map needs to plot + label a pin. Both the full
// manager `KartProject` and the lean read-only `KartWorkerProject` satisfy it,
// so workers never receive budget/ops fields they shouldn't see.
export type KartMapProject = {
  id: string
  name: string
  status: string
  lat: number | null
  lng: number | null
  budgetNok?: number | null
}

export type KartMapProps = {
  projects: KartMapProject[]
  customers: KartCustomer[]
  geofences: KartGeofence[]
  trips: KartTrip[]
  // Live badge counts per project id (crew on site now + open avvik).
  badges: Map<string, { crew: number; avvik: number }>
  selectedId: string | null
  onSelect: (id: string | null) => void
  showCustomers: boolean
  showGeofences: boolean
  showHeatmap: boolean
  showTrips: boolean
  basemap: Basemap
  geoEdit: GeoEdit | null
  onGeoEditCenter?: (lat: number, lng: number) => void
  className?: string
}

const NORWAY_CENTER: [number, number] = [10.4, 60.2]
const GEOFENCE_SOURCE = "kart-geofences"
const PROJECT_SOURCE = "kart-projects"
const HEAT_SOURCE = "kart-heat"
const TRIP_SOURCE = "kart-trips"
const GEO_EDIT_SOURCE = "kart-geoedit"

const STATUS_COLOR: Record<string, string> = {
  active: "#16a34a",
  planning: "#d97706",
  on_hold: "#64748b",
  completed: "#64748b",
}
const CUSTOMER_COLOR = "#6366f1"
const TRIP_COLOR = "#6366f1"

function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? "#2563eb"
}

function styleFor(basemap: Basemap, dark: boolean): string {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim()
  if (!key) return "https://demotiles.maplibre.org/style.json"
  if (basemap === "satellite") return `https://api.maptiler.com/maps/satellite/style.json?key=${key}`
  if (basemap === "hybrid") return `https://api.maptiler.com/maps/hybrid/style.json?key=${key}`
  const darkStyle = process.env.NEXT_PUBLIC_MAPTILER_STYLE?.trim() || "streets-v2-dark"
  const lightStyle = process.env.NEXT_PUBLIC_MAPTILER_STYLE_LIGHT?.trim() || "streets-v2"
  return `https://api.maptiler.com/maps/${dark ? darkStyle : lightStyle}/style.json?key=${key}`
}

export default function KartMap({
  projects,
  customers,
  geofences,
  trips,
  badges,
  selectedId,
  onSelect,
  showCustomers,
  showGeofences,
  showHeatmap,
  showTrips,
  basemap,
  geoEdit,
  onGeoEditCenter,
  className,
}: KartMapProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(false)
  const handlersRef = useRef(false)
  const didFitRef = useRef(false)
  const resizeObsRef = useRef<ResizeObserver | null>(null)

  const customerMarkersRef = useRef<maplibregl.Marker[]>([])
  // Project HTML markers, keyed by project id, with the last-rendered signature
  // (crew|avvik|selected) so only changed pins are rebuilt.
  const projectCacheRef = useRef<Record<string, maplibregl.Marker>>({})
  const projectSigRef = useRef<Record<string, string>>({})
  const projectOnScreenRef = useRef<Record<string, maplibregl.Marker>>({})
  const editMarkerRef = useRef<maplibregl.Marker | null>(null)

  const propsRef = useRef({
    projects,
    customers,
    geofences,
    trips,
    badges,
    selectedId,
    showCustomers,
    showGeofences,
    showHeatmap,
    showTrips,
    geoEdit,
  })
  propsRef.current = {
    projects,
    customers,
    geofences,
    trips,
    badges,
    selectedId,
    showCustomers,
    showGeofences,
    showHeatmap,
    showTrips,
    geoEdit,
  }
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])
  const onGeoEditCenterRef = useRef(onGeoEditCenter)
  useEffect(() => {
    onGeoEditCenterRef.current = onGeoEditCenter
  }, [onGeoEditCenter])

  // --- init once ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFor(basemap, isDark),
      center: NORWAY_CENTER,
      zoom: 4.2,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right")

    map.on("load", () => {
      loadedRef.current = true
      ensureLayers(map)
      registerHandlers(map)
      renderAll()
      fitToData()
      map.resize()
    })

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)
    resizeObsRef.current = ro

    return () => {
      resizeObsRef.current?.disconnect()
      resizeObsRef.current = null
      clearCustomerMarkers()
      clearProjectMarkers()
      editMarkerRef.current?.remove()
      editMarkerRef.current = null
      map.remove()
      mapRef.current = null
      loadedRef.current = false
      handlersRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- data / toggles change ---
  useEffect(() => {
    if (loadedRef.current) renderAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, customers, geofences, trips, badges, selectedId, showCustomers, showGeofences, showHeatmap, showTrips, geoEdit])

  // --- selection → fly to ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current || !selectedId) return
    const p = projects.find((x) => x.id === selectedId)
    if (p && p.lat != null && p.lng != null) {
      map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 14.5), duration: 800 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // --- basemap / theme change → swap style, re-add overlays ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    // diff:false forces a full reload. Diffing a vector style (streets) into a
    // raster one (satellite/hybrid) can no-op and leave the old basemap showing.
    map.setStyle(styleFor(basemap, isDark), { diff: false })
    map.once("styledata", () => {
      ensureLayers(map)
      renderAll()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, basemap])

  function clearCustomerMarkers() {
    customerMarkersRef.current.forEach((m) => m.remove())
    customerMarkersRef.current = []
  }

  function clearProjectMarkers() {
    Object.values(projectOnScreenRef.current).forEach((m) => m.remove())
    projectOnScreenRef.current = {}
    projectCacheRef.current = {}
    projectSigRef.current = {}
  }

  // Sync HTML project markers to the source's *unclustered* features. Runs on prop
  // changes and on every map render (so it tracks zoom/pan clustering). Only the
  // pins whose badge/selection signature changed are rebuilt.
  function syncProjectMarkers() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    if (!map.getSource(PROJECT_SOURCE) || !map.isSourceLoaded(PROJECT_SOURCE)) return
    const { projects, selectedId, badges, geoEdit } = propsRef.current
    const byId = new Map(projects.map((p) => [p.id, p]))
    // While editing a project's geofence, hide that project's pin so it can't sit
    // on top of (and steal the pointer from) the draggable center handle.
    const editingId = geoEdit ? selectedId : null

    const next: Record<string, maplibregl.Marker> = {}
    const features = map.querySourceFeatures(PROJECT_SOURCE)
    for (const f of features) {
      const props = f.properties || {}
      if (props.point_count) continue
      const id = props.id as string | undefined
      if (!id || next[id] || id === editingId) continue
      const p = byId.get(id)
      if (!p) continue
      const coords = (f.geometry as { coordinates: [number, number] }).coordinates
      const b = badges.get(id)
      const crew = b?.crew ?? 0
      const avvik = b?.avvik ?? 0
      const sig = `${crew}|${avvik}|${id === selectedId ? 1 : 0}`

      const existing = projectCacheRef.current[id]
      const onScreen = Boolean(projectOnScreenRef.current[id])
      if (!existing || projectSigRef.current[id] !== sig) {
        if (existing) existing.remove()
        const el = projectMarkerEl(p, id === selectedId, crew, avvik)
        el.addEventListener("click", (e) => {
          e.stopPropagation()
          onSelectRef.current(id)
        })
        const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(coords).addTo(map)
        projectCacheRef.current[id] = marker
        projectSigRef.current[id] = sig
        next[id] = marker
      } else {
        existing.setLngLat(coords)
        if (!onScreen) existing.addTo(map)
        next[id] = existing
      }
    }

    for (const id in projectOnScreenRef.current) {
      if (!next[id]) projectOnScreenRef.current[id].remove()
    }
    projectOnScreenRef.current = next
  }

  function renderAll() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const { projects, customers, geofences, trips, showCustomers, showGeofences, showHeatmap, showTrips } =
      propsRef.current

    // Project points (clustered) + heatmap share the same point features.
    let maxBudget = 0
    for (const p of projects) if ((p.budgetNok ?? 0) > maxBudget) maxBudget = p.budgetNok ?? 0
    const pointFeatures = projects
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({
        type: "Feature" as const,
        properties: {
          id: p.id,
          status: p.status,
          weight: maxBudget > 0 ? Math.max(0.15, (p.budgetNok ?? 0) / maxBudget) : 0.3,
        },
        geometry: { type: "Point" as const, coordinates: [p.lng as number, p.lat as number] },
      }))
    const pointData = { type: "FeatureCollection" as const, features: pointFeatures }
    ;(map.getSource(PROJECT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(pointData)
    ;(map.getSource(HEAT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(pointData)
    setVisible(map, "kart-heat", showHeatmap)
    // Best-effort immediate sync; the render handler reconciles once tiles load.
    syncProjectMarkers()

    // Customer pins stay simple HTML markers (no clustering for the 2ndary layer).
    clearCustomerMarkers()
    if (showCustomers) {
      for (const c of customers) {
        if (c.lat == null || c.lng == null) continue
        customerMarkersRef.current.push(
          new maplibregl.Marker({ element: customerMarkerEl(c), anchor: "center" })
            .setLngLat([c.lng, c.lat])
            .addTo(map)
        )
      }
    }

    // Geofences (selected always; all when toggled on). Real teig polygon when we
    // have one, else a 100 m circle fallback.
    const features: FenceFeature[] = []
    for (const gf of geofences) {
      const include = showGeofences || gf.projectId === propsRef.current.selectedId
      if (!include) continue
      const selected = gf.projectId === propsRef.current.selectedId ? 1 : 0
      if (gf.kind === "polygon" && gf.polygon) {
        features.push({ type: "Feature", properties: { selected }, geometry: gf.polygon })
      } else if (gf.centerLat != null && gf.centerLng != null) {
        const circle = geoJsonCircle(gf.centerLng, gf.centerLat, gf.radiusM || 100)
        circle.properties = { selected }
        features.push(circle)
      }
    }
    ;(map.getSource(GEOFENCE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features,
    })

    // Kjørebok routes.
    const tripFeatures = (showTrips ? trips : [])
      .filter((t) => t.coords.length > 1)
      .map((t) => ({
        type: "Feature" as const,
        properties: { id: t.id },
        geometry: { type: "LineString" as const, coordinates: t.coords },
      }))
    ;(map.getSource(TRIP_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: tripFeatures,
    })
    setVisible(map, "kart-trips-line", showTrips)

    renderGeoEdit()
  }

  // Draggable geofence editor: a movable center handle + a live preview circle.
  function renderGeoEdit() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const { geoEdit } = propsRef.current
    const src = map.getSource(GEO_EDIT_SOURCE) as maplibregl.GeoJSONSource | undefined

    if (!geoEdit) {
      if (editMarkerRef.current) {
        editMarkerRef.current.remove()
        editMarkerRef.current = null
      }
      src?.setData({ type: "FeatureCollection", features: [] })
      return
    }

    if (!editMarkerRef.current) {
      const marker = new maplibregl.Marker({ element: geoEditHandleEl(), draggable: true, anchor: "center" })
        .setLngLat([geoEdit.center.lng, geoEdit.center.lat])
        .addTo(map)
      marker.on("drag", () => drawEditCircle(marker.getLngLat()))
      marker.on("dragend", () => {
        const ll = marker.getLngLat()
        onGeoEditCenterRef.current?.(ll.lat, ll.lng)
      })
      editMarkerRef.current = marker
    }
    drawEditCircle(editMarkerRef.current.getLngLat())
  }

  function drawEditCircle(ll: maplibregl.LngLat) {
    const map = mapRef.current
    if (!map) return
    const { geoEdit } = propsRef.current
    if (!geoEdit) return
    const circle = geoJsonCircle(ll.lng, ll.lat, geoEdit.radiusM || 100)
    ;(map.getSource(GEO_EDIT_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [circle],
    })
  }

  function fitToData() {
    const map = mapRef.current
    if (!map || didFitRef.current) return
    const pts: [number, number][] = []
    for (const p of propsRef.current.projects) if (p.lat != null && p.lng != null) pts.push([p.lng, p.lat])
    if (pts.length === 0) return
    didFitRef.current = true
    if (pts.length === 1) {
      map.easeTo({ center: pts[0], zoom: 13, duration: 500 })
      return
    }
    const b = new maplibregl.LngLatBounds(pts[0], pts[0])
    pts.forEach((p) => b.extend(p))
    map.fitBounds(b, { padding: 80, maxZoom: 14, duration: 600 })
  }

  function registerHandlers(map: maplibregl.Map) {
    if (handlersRef.current) return
    handlersRef.current = true

    // Keep HTML project markers in sync with clustering after the view settles or
    // the cluster data updates. NOT on every "render" frame — that fires during a
    // marker drag and would yank the pins (and the geofence handle) mid-gesture.
    map.on("moveend", syncProjectMarkers)
    map.on("sourcedata", (e) => {
      if (e.sourceId === PROJECT_SOURCE && e.isSourceLoaded) syncProjectMarkers()
    })

    // Click a cluster → zoom to expand it.
    map.on("click", "kart-clusters", (e) => {
      const f = e.features?.[0]
      const clusterId = f?.properties?.cluster_id
      if (clusterId == null) return
      const src = map.getSource(PROJECT_SOURCE) as maplibregl.GeoJSONSource
      src.getClusterExpansionZoom(clusterId as number).then((zoom) => {
        const geom = f!.geometry as { coordinates: [number, number] }
        map.easeTo({ center: geom.coordinates, zoom: zoom + 0.25, duration: 500 })
      })
    })

    // Click empty map (not a cluster, not an HTML marker) → deselect.
    map.on("click", (e) => {
      const hit = map.queryRenderedFeatures(e.point, { layers: ["kart-clusters"] })
      if (hit.length === 0) onSelectRef.current(null)
    })

    map.on("mouseenter", "kart-clusters", () => {
      map.getCanvas().style.cursor = "pointer"
    })
    map.on("mouseleave", "kart-clusters", () => {
      map.getCanvas().style.cursor = ""
    })
  }

  return <div ref={containerRef} className={className ?? "h-full w-full"} style={{ minHeight: 320 }} />
}

function setVisible(map: maplibregl.Map, layerId: string, visible: boolean) {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none")
  }
}

function projectMarkerEl(
  p: KartMapProject,
  selected: boolean,
  crew: number,
  avvik: number
): HTMLDivElement {
  const color = statusColor(p.status)
  const size = selected ? 26 : 20
  const el = document.createElement("div")
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:50%",
    "background:#ffffff",
    `border:${selected ? 3 : 2}px solid ${color}`,
    "box-shadow:0 1px 4px rgba(0,0,0,0.35)",
    "cursor:pointer",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "position:relative",
    "transition:width .12s,height .12s",
  ].join(";")
  el.title = p.name
  const dot = document.createElement("div")
  dot.style.cssText = `width:${selected ? 9 : 7}px;height:${selected ? 9 : 7}px;border-radius:50%;background:${color}`
  el.appendChild(dot)

  // Crew-on-site count (green pill, top-right) with a soft live pulse.
  if (crew > 0) {
    const badge = document.createElement("div")
    badge.textContent = String(crew)
    badge.title = `${crew} på plass nå`
    badge.style.cssText = [
      "position:absolute",
      "top:-6px",
      "right:-6px",
      "min-width:16px",
      "height:16px",
      "padding:0 3px",
      "border-radius:8px",
      "background:#16a34a",
      "color:#ffffff",
      "font-size:10px",
      "font-weight:600",
      "line-height:16px",
      "text-align:center",
      "box-shadow:0 0 0 2px #ffffff",
    ].join(";")
    el.appendChild(badge)
    badge.animate(
      [
        { boxShadow: "0 0 0 2px #ffffff, 0 0 0 0 rgba(22,163,74,0.5)" },
        { boxShadow: "0 0 0 2px #ffffff, 0 0 0 7px rgba(22,163,74,0)" },
      ],
      { duration: 1800, iterations: Infinity }
    )
  }

  // Open avvik (red alert, top-left).
  if (avvik > 0) {
    const alert = document.createElement("div")
    alert.textContent = "!"
    alert.title = `${avvik} åpne avvik`
    alert.style.cssText = [
      "position:absolute",
      "top:-6px",
      "left:-6px",
      "width:16px",
      "height:16px",
      "border-radius:50%",
      "background:#dc2626",
      "color:#ffffff",
      "font-size:11px",
      "font-weight:700",
      "line-height:16px",
      "text-align:center",
      "box-shadow:0 0 0 2px #ffffff",
    ].join(";")
    el.appendChild(alert)
  }
  return el
}

function customerMarkerEl(c: KartCustomer): HTMLDivElement {
  const el = document.createElement("div")
  el.style.cssText = [
    "width:14px",
    "height:14px",
    "border-radius:50%",
    "background:#ffffff",
    `border:2px solid ${CUSTOMER_COLOR}`,
    "box-shadow:0 1px 3px rgba(0,0,0,0.3)",
    "opacity:0.92",
  ].join(";")
  el.title = c.name
  return el
}

// Draggable handle for the geofence editor.
function geoEditHandleEl(): HTMLDivElement {
  const el = document.createElement("div")
  el.style.cssText = [
    "width:22px",
    "height:22px",
    "border-radius:50%",
    "background:#f59e0b",
    "border:3px solid #ffffff",
    "box-shadow:0 1px 5px rgba(0,0,0,0.4)",
    "cursor:move",
  ].join(";")
  el.title = "Dra for å flytte midten"
  return el
}

// Adds every overlay source + layer. Idempotent: called on first load and again
// after each setStyle (which wipes custom sources/layers). Order = paint order:
// heat (bottom) → geofence → trips → cluster bubbles (HTML pins sit above canvas).
function ensureLayers(map: maplibregl.Map) {
  if (!map.getSource(HEAT_SOURCE)) {
    map.addSource(HEAT_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
  }
  if (!map.getLayer("kart-heat")) {
    map.addLayer({
      id: "kart-heat",
      type: "heatmap",
      source: HEAT_SOURCE,
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 0, 0, 1, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 2.5],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(0,0,0,0)",
          0.2,
          "#dbeafe",
          0.4,
          "#93c5fd",
          0.6,
          "#60a5fa",
          0.8,
          "#3b82f6",
          1,
          "#1d4ed8",
        ],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 8, 12, 40],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.85, 15, 0],
      },
    })
  }

  if (!map.getSource(GEOFENCE_SOURCE)) {
    map.addSource(GEOFENCE_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
  }
  if (!map.getLayer(`${GEOFENCE_SOURCE}-fill`)) {
    map.addLayer({
      id: `${GEOFENCE_SOURCE}-fill`,
      type: "fill",
      source: GEOFENCE_SOURCE,
      paint: {
        "fill-color": "#22c55e",
        "fill-opacity": ["case", ["==", ["get", "selected"], 1], 0.16, 0.08],
      },
    })
  }
  if (!map.getLayer(`${GEOFENCE_SOURCE}-line`)) {
    map.addLayer({
      id: `${GEOFENCE_SOURCE}-line`,
      type: "line",
      source: GEOFENCE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#22c55e",
        "line-width": ["case", ["==", ["get", "selected"], 1], 2, 1.2],
        "line-opacity": 0.7,
      },
    })
  }

  if (!map.getSource(TRIP_SOURCE)) {
    map.addSource(TRIP_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
  }
  if (!map.getLayer("kart-trips-line")) {
    map.addLayer({
      id: "kart-trips-line",
      type: "line",
      source: TRIP_SOURCE,
      layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
      paint: { "line-color": TRIP_COLOR, "line-width": 3, "line-opacity": 0.7 },
    })
  }

  if (!map.getSource(GEO_EDIT_SOURCE)) {
    map.addSource(GEO_EDIT_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
  }
  if (!map.getLayer("kart-geoedit-fill")) {
    map.addLayer({
      id: "kart-geoedit-fill",
      type: "fill",
      source: GEO_EDIT_SOURCE,
      paint: { "fill-color": "#f59e0b", "fill-opacity": 0.15 },
    })
  }
  if (!map.getLayer("kart-geoedit-line")) {
    map.addLayer({
      id: "kart-geoedit-line",
      type: "line",
      source: GEO_EDIT_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#f59e0b", "line-width": 2, "line-dasharray": [2, 1.5] },
    })
  }

  if (!map.getSource(PROJECT_SOURCE)) {
    map.addSource(PROJECT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 13,
    })
  }
  if (!map.getLayer("kart-clusters")) {
    map.addLayer({
      id: "kart-clusters",
      type: "circle",
      source: PROJECT_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#60a5fa", 10, "#3b82f6", 30, "#1d4ed8"],
        "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 30, 26],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    })
  }
  if (!map.getLayer("kart-cluster-count")) {
    map.addLayer({
      id: "kart-cluster-count",
      type: "symbol",
      source: PROJECT_SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    })
  }
}
