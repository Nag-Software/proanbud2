"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { SjefenAnalytics } from "@/lib/sjefen/analytics"
import { MAP_VIEWBOX, NORWAY_PATH } from "@/lib/sjefen/norway-geo"

const POLL_MS = 30_000

// Compact "active users" map for the Sjefen overview. Shows only the Norway
// silhouette, blips for locations with active users, and the live count.
// Polls the same admin analytics endpoint as /sjefen/analyse.
export function ActiveUsersMap({ initial }: { initial: SjefenAnalytics }) {
  const [data, setData] = useState<SjefenAnalytics>(initial)
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    // Don't poll a backgrounded tab — the data isn't visible anyway.
    if (document.visibilityState === "hidden") return
    try {
      const res = await fetch("/api/sjefen/analytics", { cache: "no-store" })
      if (!res.ok) return
      setData((await res.json()) as SjefenAnalytics)
    } catch {
      // keep last good frame
    }
  }, [])

  useEffect(() => {
    timerRef.current = window.setInterval(refresh, POLL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [refresh])

  const active = data.locations.filter((l) => l.active > 0)
  const maxActive = Math.max(1, ...active.map((l) => l.active))

  return (
    <div className="auz-card">
      <style>{AUZ_CSS}</style>
      <div className="auz-head">
        <div>
          <p className="auz-label">AKTIVE BRUKERE</p>
          <p className="auz-sub">SANNTID · NORGE</p>
        </div>
        <div className="auz-count">
          <span className={`auz-dot ${data.activeNow > 0 ? "auz-dot-live" : ""}`} />
          <span className="auz-count-val">{data.activeNow}</span>
        </div>
      </div>

      <div className="auz-mapwrap">
        <svg
          viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
          className="auz-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <radialGradient id="auz-blip" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#eafdff" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#a3e635" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#a3e635" stopOpacity="0" />
            </radialGradient>
          </defs>

          <path d={NORWAY_PATH} className="auz-land" />
          <path d={NORWAY_PATH} className="auz-land-stroke" />

          {active.map((loc) => {
            const r = 4 + (loc.active / maxActive) * 7
            return (
              <g key={loc.key} transform={`translate(${loc.x} ${loc.y})`}>
                <circle r={r + 4} className="auz-ring" style={{ animationDelay: `${(loc.x % 7) * 0.2}s` }} />
                <circle r={r * 1.8} fill="url(#auz-blip)" />
                <circle r={Math.max(2, r * 0.5)} className="auz-core" />
              </g>
            )
          })}
        </svg>
        {active.length === 0 && <p className="auz-empty">Ingen aktive brukere akkurat nå</p>}
      </div>
    </div>
  )
}

const AUZ_CSS = `
.auz-card{
  --cyan:#22d3ee; --lime:#a3e635; --dim:#5b7a8a;
  position:relative; display:flex; flex-direction:column; overflow:hidden;
  border:1px solid rgba(34,211,238,0.18); border-radius:12px;
  background:
    radial-gradient(120% 90% at 80% 0%, rgba(34,211,238,0.10), transparent 55%),
    #04070d;
  color:#cbe6f0; min-height:340px;
}
.auz-head{
  display:flex; align-items:flex-start; justify-content:space-between;
  padding:14px 16px 8px; border-bottom:1px solid rgba(34,211,238,0.12);
}
.auz-label{ margin:0; font-size:11px; font-weight:700; letter-spacing:0.24em; color:#eafdff; }
.auz-sub{ margin:2px 0 0; font-size:8.5px; letter-spacing:0.26em; color:var(--dim); }
.auz-count{ display:flex; align-items:center; gap:8px; }
.auz-count-val{
  font-family:var(--font-geist-mono, ui-monospace, monospace); font-variant-numeric:tabular-nums;
  font-size:30px; font-weight:700; line-height:1; color:var(--lime); text-shadow:0 0 12px rgba(163,230,53,0.5);
}
.auz-dot{ width:9px; height:9px; border-radius:50%; background:var(--dim); }
.auz-dot-live{ background:var(--lime); box-shadow:0 0 10px var(--lime); animation:auz-blink 1.4s infinite; }
.auz-mapwrap{ position:relative; flex:1; display:flex; align-items:center; justify-content:center; padding:8px; min-height:0; }
.auz-svg{ width:100%; height:100%; max-height:360px; }
.auz-land{ fill:rgba(34,211,238,0.06); }
.auz-land-stroke{ fill:none; stroke:var(--cyan); stroke-width:1.1; stroke-linejoin:round; opacity:0.8; filter:drop-shadow(0 0 5px rgba(34,211,238,0.5)); }
.auz-core{ fill:#eafdff; filter:drop-shadow(0 0 4px var(--lime)); }
.auz-ring{ fill:none; stroke:var(--lime); stroke-width:1; opacity:0; transform-box:fill-box; transform-origin:center; animation:auz-ping 2.4s ease-out infinite; }
.auz-empty{ position:absolute; bottom:14px; left:50%; transform:translateX(-50%); margin:0; font-size:10px; letter-spacing:0.12em; color:var(--dim); white-space:nowrap; }
@keyframes auz-blink{ 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes auz-ping{ 0%{ transform:scale(0.5); opacity:0.8 } 100%{ transform:scale(2.4); opacity:0 } }
@media (prefers-reduced-motion: reduce){ .auz-ring,.auz-dot-live{ animation:none; } }
`
