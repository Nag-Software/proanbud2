"use client"

import { useEffect, useRef } from "react"
import maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

import type { LngLat, RouteResult } from "@/lib/kjorebok/types"

// Dark, CarPlay-like vector map. Renders one or more route polylines (the
// selected one bright with a glow, alternatives muted), start/end markers and an
// optional live-location puck. When several routes are supplied they become
// clickable (line + a time pill) so the user can pick one, Google-Maps-style.
// Because maplibre-gl touches `window`, consumers must load this via
// next/dynamic with ssr:false.

type LatLng = { lat: number; lng: number }

type RouteFeature = {
  type: "Feature"
  properties: { index: number; selected: 0 | 1 }
  geometry: { type: "LineString"; coordinates: LngLat[] }
}

export type TripMapProps = {
  routeGeometry?: LngLat[] | null
  /** Candidate routes for the picker. Takes precedence over routeGeometry. */
  routes?: RouteResult[] | null
  selectedRouteIndex?: number
  onSelectRoute?: (index: number) => void
  from?: LatLng | null
  to?: LatLng | null
  /** Current position while live-tracking (pulsing puck). */
  livePuck?: LatLng | null
  interactive?: boolean
  className?: string
}

const OSLO: [number, number] = [10.7522, 59.9139]
const ROUTE_SOURCE = "kjorebok-route"

function styleUrl(): string {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim()
  const style = process.env.NEXT_PUBLIC_MAPTILER_STYLE?.trim() || "streets-v2-dark"
  if (key) return `https://api.maptiler.com/maps/${style}/style.json?key=${key}`
  // Keyless dev fallback — still renders (lower detail, not dark).
  return "https://demotiles.maplibre.org/style.json"
}

export function TripMap({
  routeGeometry,
  routes,
  selectedRouteIndex = 0,
  onSelectRoute,
  from,
  to,
  livePuck,
  interactive = true,
  className,
}: TripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const loadedRef = useRef(false)
  const markers = useRef<{
    from?: maplibregl.Marker
    to?: maplibregl.Marker
    puck?: maplibregl.Marker
    routeLabels: maplibregl.Marker[]
  }>({ routeLabels: [] })
  // Click handlers are registered once on load, so read the latest callback via a ref.
  const onSelectRouteRef = useRef(onSelectRoute)
  useEffect(() => {
    onSelectRouteRef.current = onSelectRoute
  }, [onSelectRoute])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleUrl(),
      center: from ? [from.lng, from.lat] : OSLO,
      zoom: 11,
      interactive,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    if (interactive) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right")
    }
    map.on("load", () => {
      loadedRef.current = true
      ensureRouteLayer(map)
      const lineLayer = `${ROUTE_SOURCE}-line`
      map.on("click", lineLayer, (e) => {
        const raw = e.features?.[0]?.properties?.index
        const idx = typeof raw === "number" ? raw : Number(raw)
        if (Number.isFinite(idx)) onSelectRouteRef.current?.(idx)
      })
      map.on("mouseenter", lineLayer, () => {
        if (onSelectRouteRef.current) map.getCanvas().style.cursor = "pointer"
      })
      map.on("mouseleave", lineLayer, () => {
        map.getCanvas().style.cursor = ""
      })
      applyData()
    })
    return () => {
      markers.current.routeLabels.forEach((m) => m.remove())
      ;[markers.current.from, markers.current.to, markers.current.puck].forEach((m) => m?.remove())
      markers.current = { routeLabels: [] }
      map.remove()
      mapRef.current = null
      loadedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    applyData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    routeGeometry,
    routes,
    selectedRouteIndex,
    from?.lat,
    from?.lng,
    to?.lat,
    to?.lng,
    livePuck?.lat,
    livePuck?.lng,
  ])

  function buildFeatures(): RouteFeature[] {
    if (routes && routes.length > 0) {
      return routes
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => Array.isArray(r.geometry) && r.geometry.length > 1)
        .map(({ r, i }) => lineFeature(r.geometry, i, i === selectedRouteIndex))
    }
    if (routeGeometry && routeGeometry.length > 1) {
      return [lineFeature(routeGeometry, 0, true)]
    }
    if (from && to) {
      return [
        lineFeature(
          [
            [from.lng, from.lat],
            [to.lng, to.lat],
          ],
          0,
          true
        ),
      ]
    }
    return []
  }

  function applyData() {
    const map = mapRef.current
    if (!map || !loadedRef.current) return

    const features = buildFeatures()
    const src = map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: "FeatureCollection", features })

    setMarker("from", from, "#34d399")
    setMarker("to", to, "#f87171")
    setPuck(livePuck)
    syncRouteLabels()

    const fitPts: [number, number][] = features.length
      ? features.flatMap((f) => f.geometry.coordinates)
      : ([from, to].filter(Boolean) as LatLng[]).map((p) => [p.lng, p.lat])
    if (fitPts.length === 1) {
      map.easeTo({ center: fitPts[0], zoom: 13, duration: 500 })
    } else if (fitPts.length > 1) {
      const b = new maplibregl.LngLatBounds(fitPts[0], fitPts[0])
      fitPts.forEach((p) => b.extend(p))
      map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 600 })
    }
  }

  // Clickable "23 min" pills at each alternative's midpoint (only when there's a
  // real choice to make, i.e. more than one route).
  function syncRouteLabels() {
    const map = mapRef.current
    if (!map) return
    markers.current.routeLabels.forEach((m) => m.remove())
    markers.current.routeLabels = []
    if (!routes || routes.length < 2) return
    routes.forEach((r, i) => {
      if (!Array.isArray(r.geometry) || r.geometry.length < 2) return
      const mid = r.geometry[Math.floor(r.geometry.length / 2)]
      const selected = i === selectedRouteIndex
      const el = document.createElement("button")
      el.type = "button"
      el.className = `kjorebok-route-label${selected ? " is-selected" : ""}`
      el.textContent = r.durationMin != null ? `${r.durationMin} min` : `${Math.round(r.distanceKm)} km`
      el.addEventListener("click", (ev) => {
        ev.stopPropagation()
        onSelectRouteRef.current?.(i)
      })
      const marker = new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(map)
      markers.current.routeLabels.push(marker)
    })
  }

  function setMarker(key: "from" | "to", point: LatLng | null | undefined, color: string) {
    const map = mapRef.current
    if (!map) return
    if (!point) {
      markers.current[key]?.remove()
      markers.current[key] = undefined
      return
    }
    if (!markers.current[key]) {
      markers.current[key] = new maplibregl.Marker({ color }).setLngLat([point.lng, point.lat]).addTo(map)
    } else {
      markers.current[key]!.setLngLat([point.lng, point.lat])
    }
  }

  function setPuck(point: LatLng | null | undefined) {
    const map = mapRef.current
    if (!map) return
    if (!point) {
      markers.current.puck?.remove()
      markers.current.puck = undefined
      return
    }
    if (!markers.current.puck) {
      const el = document.createElement("div")
      el.className = "kjorebok-puck"
      markers.current.puck = new maplibregl.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map)
    } else {
      markers.current.puck.setLngLat([point.lng, point.lat])
    }
  }

  return (
    <div
      ref={containerRef}
      className={className ?? "h-full w-full"}
      style={{ minHeight: 240, borderRadius: 12, overflow: "hidden" }}
    />
  )
}

function lineFeature(coords: LngLat[], index: number, selected: boolean): RouteFeature {
  return {
    type: "Feature",
    properties: { index, selected: selected ? 1 : 0 },
    geometry: { type: "LineString", coordinates: coords },
  }
}

function ensureRouteLayer(map: maplibregl.Map) {
  if (map.getSource(ROUTE_SOURCE)) return
  map.addSource(ROUTE_SOURCE, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  })
  // Glow underlay for the selected route only.
  map.addLayer({
    id: `${ROUTE_SOURCE}-glow`,
    type: "line",
    source: ROUTE_SOURCE,
    filter: ["==", ["get", "selected"], 1],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#38bdf8", "line-width": 14, "line-opacity": 0.22, "line-blur": 4 },
  })
  // All routes. The selected one is brighter, wider and drawn on top via sort-key;
  // alternatives are muted grey and clickable.
  map.addLayer({
    id: `${ROUTE_SOURCE}-line`,
    type: "line",
    source: ROUTE_SOURCE,
    layout: {
      "line-cap": "round",
      "line-join": "round",
      "line-sort-key": ["get", "selected"],
    },
    paint: {
      "line-color": ["case", ["==", ["get", "selected"], 1], "#38bdf8", "#94a3b8"],
      "line-width": ["case", ["==", ["get", "selected"], 1], 6, 4],
      "line-opacity": ["case", ["==", ["get", "selected"], 1], 1, 0.8],
    },
  })
}

export default TripMap
