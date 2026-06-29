"use client"

import { useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import { useTheme } from "next-themes"

import { geoJsonCircle, type GeoCircle } from "@/lib/geo/circle"
import type { KartProject, KartCustomer } from "@/app/kart/actions"

// Apple-Maps-like operations map. Renders project + customer pins and project
// geofence circles on a clean light/dark MapTiler basemap. maplibre-gl touches
// `window`, so consumers must load this via next/dynamic with ssr:false.

export type KartMapProps = {
  projects: KartProject[]
  customers: KartCustomer[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  showCustomers: boolean
  showGeofences: boolean
  geofenceRadiusM?: number
  className?: string
}

const NORWAY_CENTER: [number, number] = [10.4, 60.2]
const GEOFENCE_SOURCE = "kart-geofences"

const STATUS_COLOR: Record<string, string> = {
  active: "#16a34a",
  planning: "#d97706",
  on_hold: "#64748b",
  completed: "#64748b",
}
const CUSTOMER_COLOR = "#6366f1"

function statusColor(status: string): string {
  return STATUS_COLOR[status] ?? "#2563eb"
}

function styleUrl(dark: boolean): string {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim()
  const darkStyle = process.env.NEXT_PUBLIC_MAPTILER_STYLE?.trim() || "streets-v2-dark"
  const lightStyle = process.env.NEXT_PUBLIC_MAPTILER_STYLE_LIGHT?.trim() || "streets-v2"
  const style = dark ? darkStyle : lightStyle
  if (key) return `https://api.maptiler.com/maps/${style}/style.json?key=${key}`
  return "https://demotiles.maplibre.org/style.json"
}

export default function KartMap({
  projects,
  customers,
  selectedId,
  onSelect,
  showCustomers,
  showGeofences,
  geofenceRadiusM = 100,
  className,
}: KartMapProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(false)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const didFitRef = useRef(false)
  const resizeObsRef = useRef<ResizeObserver | null>(null)

  // Latest props for imperative handlers/effects that register once.
  const propsRef = useRef({ projects, customers, selectedId, showCustomers, showGeofences, geofenceRadiusM })
  propsRef.current = { projects, customers, selectedId, showCustomers, showGeofences, geofenceRadiusM }
  const onSelectRef = useRef(onSelect)
  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  // --- init once ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl(isDark),
      center: NORWAY_CENTER,
      zoom: 4.2,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right")

    map.on("load", () => {
      loadedRef.current = true
      ensureGeofenceLayer(map)
      renderAll()
      fitToData()
      map.resize()
    })

    // The map can mount before layout settles its size — observe the container
    // and resize so MapLibre paints tiles for the real viewport (not a 0/300px box).
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)
    resizeObsRef.current = ro

    return () => {
      resizeObsRef.current?.disconnect()
      resizeObsRef.current = null
      clearMarkers()
      map.remove()
      mapRef.current = null
      loadedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- data / toggles change ---
  useEffect(() => {
    if (loadedRef.current) renderAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, customers, selectedId, showCustomers, showGeofences, geofenceRadiusM])

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

  // --- theme change → swap basemap, keep overlays ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    map.setStyle(styleUrl(isDark))
    map.once("styledata", () => {
      ensureGeofenceLayer(map)
      renderAll()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark])

  function clearMarkers() {
    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
  }

  function renderAll() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return
    const { projects, customers, selectedId, showCustomers, showGeofences, geofenceRadiusM } =
      propsRef.current

    // Markers
    clearMarkers()
    for (const p of projects) {
      if (p.lat == null || p.lng == null) continue
      const el = projectMarkerEl(p, p.id === selectedId)
      el.addEventListener("click", (e) => {
        e.stopPropagation()
        onSelectRef.current(p.id)
      })
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([p.lng, p.lat]).addTo(map)
      )
    }
    if (showCustomers) {
      for (const c of customers) {
        if (c.lat == null || c.lng == null) continue
        const el = customerMarkerEl(c)
        markersRef.current.push(
          new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([c.lng, c.lat]).addTo(map)
        )
      }
    }

    // Geofence circles (selected always; all when toggled on)
    const features: GeoCircle[] = []
    for (const p of projects) {
      if (p.lat == null || p.lng == null) continue
      const include = showGeofences || p.id === selectedId
      if (!include) continue
      const circle = geoJsonCircle(p.lng, p.lat, geofenceRadiusM)
      circle.properties = { selected: p.id === selectedId ? 1 : 0 }
      features.push(circle)
    }
    const src = map.getSource(GEOFENCE_SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: "FeatureCollection", features })
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

  return (
    <div
      ref={containerRef}
      className={className ?? "h-full w-full"}
      style={{ minHeight: 320 }}
      onClick={() => onSelectRef.current(null)}
    />
  )
}

function projectMarkerEl(p: KartProject, selected: boolean): HTMLDivElement {
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
    "transition:width .12s,height .12s",
  ].join(";")
  el.title = p.name
  const dot = document.createElement("div")
  dot.style.cssText = `width:${selected ? 9 : 7}px;height:${selected ? 9 : 7}px;border-radius:50%;background:${color}`
  el.appendChild(dot)
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

function ensureGeofenceLayer(map: maplibregl.Map) {
  if (!map.getSource(GEOFENCE_SOURCE)) {
    map.addSource(GEOFENCE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    })
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
}
