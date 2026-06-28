"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { CircleStopIcon, NavigationIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { haversineKm } from "@/lib/kjorebok/haversine"
import type { LiveTripDraft, LngLat } from "@/lib/kjorebok/types"

// maplibre touches `window` — load the map client-only.
const TripMap = dynamic(() => import("./trip-map").then((m) => m.TripMap), { ssr: false })

const BUFFER_KEY = "kjorebok:live-buffer"
const MIN_SEGMENT_KM = 0.01 // ignore <10 m GPS jitter

type Props = {
  onComplete: (draft: LiveTripDraft) => void
  onCancel: () => void
}

type Buffer = { startTime: string; coords: LngLat[]; distanceKm: number }
type WakeLockLike = { release: () => Promise<void> }

export function LiveTracker({ onComplete, onCancel }: Props) {
  const [tracking, setTracking] = useState(false)
  const [coords, setCoords] = useState<LngLat[]>([])
  const [distanceKm, setDistanceKm] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)

  const watchRef = useRef<number | null>(null)
  const wakeLockRef = useRef<WakeLockLike | null>(null)
  const startTimeRef = useRef<string | null>(null)
  const lastFixRef = useRef<{ lat: number; lng: number } | null>(null)
  const coordsRef = useRef<LngLat[]>([])
  const distanceRef = useRef(0)

  const persist = useCallback(() => {
    if (!startTimeRef.current) return
    try {
      sessionStorage.setItem(
        BUFFER_KEY,
        JSON.stringify({ startTime: startTimeRef.current, coords: coordsRef.current, distanceKm: distanceRef.current })
      )
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [])

  // Offer to recover an unfinished session on mount.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BUFFER_KEY)
      if (!raw) return
      const buf = JSON.parse(raw) as Buffer
      if (buf?.coords?.length && startedRecently(buf.startTime)) {
        startTimeRef.current = buf.startTime
        coordsRef.current = buf.coords
        distanceRef.current = buf.distanceKm || 0
        lastFixRef.current = lastOf(buf.coords)
        setCoords(buf.coords)
        setDistanceKm(buf.distanceKm || 0)
        // Seed elapsed from the real (older) start so the recovered card shows the
        // true duration instead of 00:00 before the user resumes.
        setElapsed(Math.max(0, Math.floor((Date.now() - new Date(buf.startTime).getTime()) / 1000)))
        setError("Gjenopprettet en uavsluttet økt. Trykk «Stopp» for å lagre, eller fortsett å kjøre.")
      } else {
        sessionStorage.removeItem(BUFFER_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Elapsed timer.
  useEffect(() => {
    if (!tracking || !startTimeRef.current) return
    const start = new Date(startTimeRef.current).getTime()
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000)
    return () => clearInterval(id)
  }, [tracking])

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }, [])

  const acquireWakeLock = useCallback(async () => {
    try {
      const anyNav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockLike> } }
      if (anyNav.wakeLock) wakeLockRef.current = await anyNav.wakeLock.request("screen")
    } catch {
      /* best-effort */
    }
  }, [])

  // Re-acquire wake lock when the tab returns to foreground.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible" && tracking) void acquireWakeLock()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [tracking, acquireWakeLock])

  const stopWatch = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    releaseWakeLock()
  }, [releaseWakeLock])

  useEffect(() => () => stopWatch(), [stopWatch])

  function start() {
    if (!("geolocation" in navigator)) {
      setError("Enheten støtter ikke posisjon.")
      return
    }
    setError(null)
    // Resume a recovered/in-progress session instead of wiping it — the button
    // labelled "Fortsett" must keep the accumulated coords + distance + start time
    // (lastFixRef was seeded during recovery, so distance continues from there).
    const resuming = coordsRef.current.length > 0 && Boolean(startTimeRef.current)
    if (!resuming) {
      startTimeRef.current = new Date().toISOString()
      coordsRef.current = []
      distanceRef.current = 0
      lastFixRef.current = null
      setCoords([])
      setDistanceKm(0)
      setElapsed(0)
    }
    setTracking(true)
    void acquireWakeLock()

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const prev = lastFixRef.current
        if (prev) {
          const seg = haversineKm(prev, fix)
          if (seg < MIN_SEGMENT_KM) return // ignore jitter
          distanceRef.current += seg
        }
        lastFixRef.current = fix
        coordsRef.current = [...coordsRef.current, [fix.lng, fix.lat]]
        setCoords(coordsRef.current)
        setDistanceKm(distanceRef.current)
        persist()
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          // On iPhone a denial can come from EITHER the global Location Services
          // toggle OR the per-site/app permission — and when the global toggle is
          // off, Safari/iOS reports PERMISSION_DENIED with no in-page prompt to
          // tap, so "allow in the page" alone can't fix it. Name both paths.
          setError("Posisjon ble avslått. På iPhone: sjekk at Posisjonstjenester er på under Innstillinger → Personvern og sikkerhet, og at nettleseren har posisjonstilgang. Du kan også registrere turen manuelt.")
        } else {
          setError("Fikk ikke posisjon akkurat nå. Hold appen åpen og prøv igjen.")
        }
        setTracking(false)
        stopWatch()
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
    )
  }

  async function stop() {
    setTracking(false)
    stopWatch()
    setFinishing(true)
    const startTime = startTimeRef.current ?? new Date().toISOString()
    const endTime = new Date().toISOString()
    const path = coordsRef.current
    const first = path[0]
    const last = lastOfArr(path)

    const [fromAddr, toAddr] = await Promise.all([
      first ? reverseGeocode(first[1], first[0]) : Promise.resolve(null),
      last ? reverseGeocode(last[1], last[0]) : Promise.resolve(null),
    ])

    try {
      sessionStorage.removeItem(BUFFER_KEY)
    } catch {
      /* ignore */
    }

    const draft: LiveTripDraft = {
      source: "gps",
      startTime,
      endTime,
      distanceKm: Math.round(distanceRef.current * 100) / 100,
      routeGeometry: path,
      fromLat: first ? first[1] : null,
      fromLng: first ? first[0] : null,
      fromAddress: fromAddr,
      toLat: last ? last[1] : null,
      toLng: last ? last[0] : null,
      toAddress: toAddr,
    }
    setFinishing(false)
    onComplete(draft)
  }

  const livePuck = coords.length ? { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] } : null

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border">
        <TripMap routeGeometry={coords} livePuck={livePuck} interactive className="h-[300px] w-full" />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
        <Stat label="Distanse" value={`${distanceKm.toFixed(1)} km`} />
        <Stat label="Tid" value={formatElapsed(elapsed)} />
        <Stat label="Punkter" value={String(coords.length)} />
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        Hold appen åpen og skjermen på under kjøring. Bakgrunnssporing kommer i mobilappen.
      </p>

      {error && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {!tracking ? (
          <Button onClick={start} className="flex-1" disabled={finishing}>
            <NavigationIcon className="size-4" /> {coords.length ? "Fortsett" : "Start kjøring"}
          </Button>
        ) : (
          <Button onClick={stop} variant="destructive" className="flex-1" disabled={finishing}>
            <CircleStopIcon className="size-4" /> Stopp
          </Button>
        )}
        {!tracking && coords.length > 0 && (
          <Button onClick={stop} variant="default" className="flex-1" disabled={finishing}>
            Lagre tur
          </Button>
        )}
        <Button variant="outline" onClick={onCancel} disabled={finishing}>
          Avbryt
        </Button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/kjorebok/geocode?lat=${lat}&lng=${lng}`)
    const data = await res.json()
    return data?.results?.[0]?.label ?? null
  } catch {
    return null
  }
}

function startedRecently(iso: string): boolean {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && Date.now() - t < 2 * 60 * 60 * 1000
}

function lastOf(coords: LngLat[]): { lat: number; lng: number } | null {
  const c = lastOfArr(coords)
  return c ? { lat: c[1], lng: c[0] } : null
}
function lastOfArr<T>(arr: T[]): T | null {
  return arr.length ? arr[arr.length - 1] : null
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(s).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
