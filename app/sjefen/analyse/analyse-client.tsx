"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { SjefenPageShell } from "@/components/sjefen/sjefen-page-shell"
import type { LiveLocation, SjefenAnalytics } from "@/lib/sjefen/analytics"
import { MAP_VIEWBOX, NORWAY_PATH, project } from "@/lib/sjefen/norway-geo"

const POLL_MS = 30_000

// Latitude/longitude graticule for the HUD grid overlay (drawn with the same
// projection as the silhouette so it lines up).
const GRID_LATS = [59, 61, 63, 65, 67, 69, 71]
const GRID_LNGS = [6, 11, 16, 21, 26, 31]

function gridLine(points: Array<[number, number]>) {
  return points.map(([lng, lat], i) => {
    const [x, y] = project(lng, lat)
    return `${i === 0 ? "M" : "L"}${x} ${y}`
  }).join(" ")
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—"
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return "NÅ"
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} min`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs} t`
  return `${Math.floor(hrs / 24)} d`
}

function isLiveNow(iso: string | null): boolean {
  if (!iso) return false
  return Date.now() - new Date(iso).getTime() <= 5 * 60 * 1000
}

export function AnalyseClient({ initial }: { initial: SjefenAnalytics }) {
  const [data, setData] = useState<SjefenAnalytics>(initial)
  const [clock, setClock] = useState<string>("")
  const [pulse, setPulse] = useState(false)
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    // Don't poll a backgrounded tab — the data isn't visible anyway.
    if (document.visibilityState === "hidden") return
    try {
      const res = await fetch("/api/sjefen/analytics", { cache: "no-store" })
      if (!res.ok) return
      const next = (await res.json()) as SjefenAnalytics
      setData(next)
      setPulse(true)
      window.setTimeout(() => setPulse(false), 900)
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

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, "0")
      setClock(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`)
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])

  const maxTotal = Math.max(1, ...data.locations.map((l) => l.total))

  return (
    <SjefenPageShell segments={["Sjefen", "Analyse"]} noPadding>
      <div className="ops-root">
        <style>{OPS_CSS}</style>

        {/* Command bar */}
        <div className="ops-bar">
          <div className="flex items-center gap-3">
            <span className={`ops-led ${data.activeNow > 0 ? "ops-led-live" : ""}`} />
            <div>
              <p className="ops-title">OPERASJONSKONTROLL</p>
              <p className="ops-sub">PROANBUD · SANNTIDS BRUKEROVERSIKT · NORGE</p>
            </div>
          </div>
          <div className="ops-bar-right">
            <div className="ops-readout">
              <span className="ops-readout-label">AKTIVE NÅ</span>
              <span className="ops-readout-value ops-accent-live">{data.activeNow}</span>
            </div>
            <div className="ops-readout">
              <span className="ops-readout-label">SYSTEMTID</span>
              <span className="ops-readout-value ops-mono">{clock || "--:--:--"}</span>
            </div>
            <span className={`ops-sync ${pulse ? "ops-sync-on" : ""}`}>● LIVE</span>
          </div>
        </div>

        {!data.presenceEnabled && (
          <div className="ops-warn">
            ⚠ PRESENCE-SPORING IKKE AKTIVERT — kjør <code>db/32_user_presence.sql</code> for live aktiv-bruker-data.
          </div>
        )}

        {/* Main grid */}
        <div className="ops-grid">
          {/* Left HUD */}
          <div className="ops-hud">
            <div className="ops-stats">
              <StatCard label="AKTIVE NÅ" value={data.activeNow} accent="live" big />
              <StatCard label="AKTIVE 24T" value={data.active24h} />
              <StatCard label="AKTIVE 7D" value={data.active7d} />
              <StatCard label="TOT. BRUKERE" value={data.totalUsers} />
              <StatCard label="FIRMAER" value={data.totalCompanies} />
              <StatCard label="ØKTER LIVE" value={data.activeSessions} accent="amber" />
              <StatCard label="TIMER I DAG" value={data.hoursToday} suffix="t" />
              <StatCard label="TIMER TOT." value={data.hoursTotal} suffix="t" />
            </div>

            <div className="ops-panel">
              <p className="ops-panel-title">TOPP-LOKASJONER</p>
              <div className="ops-loclist">
                {data.locations.length === 0 && (
                  <p className="ops-empty">Ingen lokaliserte brukere ennå.</p>
                )}
                {data.locations.slice(0, 8).map((loc) => (
                  <div key={loc.key} className="ops-locrow">
                    <span className="ops-locname">{loc.name}</span>
                    <div className="ops-locbar">
                      <div
                        className="ops-locbar-fill"
                        style={{ width: `${(loc.total / maxTotal) * 100}%` }}
                      />
                    </div>
                    <span className="ops-loccount">
                      {loc.active > 0 && <span className="ops-accent-live">{loc.active}/</span>}
                      {loc.total}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Map */}
          <div className="ops-mapwrap">
            <div className="ops-corner ops-corner-tl" />
            <div className="ops-corner ops-corner-tr" />
            <div className="ops-corner ops-corner-bl" />
            <div className="ops-corner ops-corner-br" />
            <NorwayMap locations={data.locations} maxTotal={maxTotal} />
            <div className="ops-scan" />
            <div className="ops-maplabel">
              KART: NORGE · {data.locations.length} SEKTORER AKTIVE
            </div>
          </div>

          {/* Live feed */}
          <div className="ops-feed">
            <p className="ops-panel-title">
              LIVE AKTIVITET <span className="ops-feed-dot" />
            </p>
            <div className="ops-feedlist">
              {data.feed.length === 0 && <p className="ops-empty">Ingen aktivitet registrert.</p>}
              {data.feed.map((u) => {
                const live = isLiveNow(u.lastSeenAt)
                return (
                  <div key={u.id} className="ops-feedrow">
                    <span className={`ops-feed-led ${live ? "ops-feed-led-live" : ""}`} />
                    <div className="ops-feed-main">
                      <span className="ops-feed-name">{u.name}</span>
                      <span className="ops-feed-meta">
                        {u.company}
                        {u.location ? ` · ${u.location}` : ""}
                      </span>
                    </div>
                    <span className={`ops-feed-time ${live ? "ops-accent-live" : ""}`}>
                      {relativeTime(u.lastSeenAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </SjefenPageShell>
  )
}

function StatCard({
  label,
  value,
  accent,
  suffix,
  big,
}: {
  label: string
  value: number
  accent?: "live" | "amber"
  suffix?: string
  big?: boolean
}) {
  return (
    <div className={`ops-stat ${big ? "ops-stat-big" : ""}`}>
      <span className="ops-stat-label">{label}</span>
      <span
        className={`ops-stat-value ${
          accent === "live" ? "ops-accent-live" : accent === "amber" ? "ops-accent-amber" : ""
        }`}
      >
        {value.toLocaleString("nb-NO")}
        {suffix && <span className="ops-stat-suffix">{suffix}</span>}
      </span>
    </div>
  )
}

function NorwayMap({ locations, maxTotal }: { locations: LiveLocation[]; maxTotal: number }) {
  return (
    <div className="ops-radar">
      <div className="ops-sweep" />
      <svg
        viewBox={`0 0 ${MAP_VIEWBOX.width} ${MAP_VIEWBOX.height}`}
        className="ops-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <radialGradient id="ops-blip" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#bdf5ff" stopOpacity="0.95" />
            <stop offset="40%" stopColor="#22d3ee" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
          <filter id="ops-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Graticule */}
        <g className="ops-grid">
          {GRID_LATS.map((lat) => (
            <path key={`lat-${lat}`} d={gridLine([[4, lat], [31.5, lat]])} />
          ))}
          {GRID_LNGS.map((lng) => (
            <path key={`lng-${lng}`} d={gridLine([[lng, 57.7], [lng, 71.4]])} />
          ))}
        </g>

        {/* Norway silhouette */}
        <path d={NORWAY_PATH} className="ops-land" filter="url(#ops-glow)" />
        <path d={NORWAY_PATH} className="ops-land-stroke" />

        {/* Location blips */}
        {locations.map((loc) => {
          const r = 4 + (loc.total / maxTotal) * 9
          const active = loc.active > 0
          return (
            <g key={loc.key} transform={`translate(${loc.x} ${loc.y})`}>
              {active && (
                <circle r={r + 4} className="ops-ring" style={{ animationDelay: `${(loc.x % 7) * 0.2}s` }} />
              )}
              <circle r={r * 1.7} fill="url(#ops-blip)" opacity={active ? 0.9 : 0.4} />
              <circle
                r={Math.max(2, r * 0.5)}
                className={active ? "ops-core ops-core-live" : "ops-core"}
              />
              {loc.total >= Math.max(2, maxTotal * 0.5) && (
                <text x={r + 6} y={3} className="ops-blip-label">
                  {loc.name.toUpperCase()}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const OPS_CSS = `
.ops-root{
  --bg:#04070d; --panel:rgba(10,18,28,0.72); --line:rgba(34,211,238,0.16);
  --cyan:#22d3ee; --cyan-soft:rgba(34,211,238,0.7); --lime:#a3e635;
  --amber:#fbbf24; --txt:#cbe6f0; --dim:#5b7a8a;
  position:relative; height:100%; width:100%; overflow-y:auto; color:var(--txt);
  background:
    radial-gradient(900px 600px at 75% 20%, rgba(34,211,238,0.10), transparent 60%),
    radial-gradient(700px 500px at 20% 90%, rgba(163,230,53,0.06), transparent 60%),
    var(--bg);
  font-family:var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif);
}
.ops-root::before{
  content:""; position:absolute; inset:0; pointer-events:none; z-index:50;
  background:repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.18) 3px);
  opacity:0.35; mix-blend-mode:overlay;
}
.ops-mono, .ops-stat-value, .ops-readout-value, .ops-loccount, .ops-feed-time, .ops-blip-label{
  font-family:var(--font-geist-mono, ui-monospace, "SFMono-Regular", monospace);
  font-variant-numeric:tabular-nums;
}

/* Command bar */
.ops-bar{
  position:sticky; top:0; z-index:30; display:flex; flex-wrap:wrap; gap:12px;
  align-items:center; justify-content:space-between;
  padding:14px 18px; border-bottom:1px solid var(--line);
  background:linear-gradient(180deg, rgba(6,12,20,0.95), rgba(6,12,20,0.55));
  backdrop-filter:blur(6px);
}
.ops-title{ font-size:14px; font-weight:700; letter-spacing:0.34em; color:#eafdff; margin:0; }
.ops-sub{ font-size:9.5px; letter-spacing:0.28em; color:var(--dim); margin:2px 0 0; }
.ops-bar-right{ display:flex; align-items:center; gap:18px; }
.ops-readout{ display:flex; flex-direction:column; align-items:flex-end; }
.ops-readout-label{ font-size:8.5px; letter-spacing:0.2em; color:var(--dim); }
.ops-readout-value{ font-size:16px; font-weight:700; color:#eafdff; }
.ops-led{ width:9px; height:9px; border-radius:50%; background:var(--dim); box-shadow:0 0 8px rgba(91,122,138,0.6); }
.ops-led-live{ background:var(--lime); box-shadow:0 0 12px var(--lime); animation:ops-blink 1.4s infinite; }
.ops-sync{ font-size:9px; letter-spacing:0.2em; color:var(--dim); transition:color .3s, text-shadow .3s; }
.ops-sync-on{ color:var(--lime); text-shadow:0 0 8px var(--lime); }

.ops-accent-live{ color:var(--lime); }
.ops-accent-amber{ color:var(--amber); }

.ops-warn{
  margin:10px 18px 0; padding:8px 12px; font-size:11px; letter-spacing:0.04em;
  border:1px solid rgba(251,191,36,0.4); background:rgba(251,191,36,0.08); color:var(--amber);
}
.ops-warn code{ font-family:var(--font-geist-mono, monospace); color:#ffe9b0; }

/* Layout grid */
.ops-grid{
  display:grid; gap:14px; padding:14px 18px 22px;
  grid-template-columns:1fr;
}
@media(min-width:1024px){
  .ops-grid{
    grid-template-columns:minmax(300px,360px) minmax(0,1fr) minmax(260px,320px);
    grid-template-rows:1fr; align-items:stretch;
  }
}

/* Stat cards */
.ops-hud{ display:flex; flex-direction:column; gap:14px; min-width:0; }
.ops-stats{ display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
.ops-stat{
  position:relative; border:1px solid var(--line); background:var(--panel);
  padding:10px 12px; clip-path:polygon(0 0, 100% 0, 100% 70%, 92% 100%, 0 100%);
}
.ops-stat-big{ grid-column:span 2; }
.ops-stat-label{ display:block; font-size:8.5px; letter-spacing:0.22em; color:var(--dim); }
.ops-stat-value{ display:block; margin-top:3px; font-size:24px; font-weight:700; color:#eafdff; line-height:1; }
.ops-stat-big .ops-stat-value{ font-size:40px; }
.ops-stat-suffix{ font-size:13px; color:var(--dim); margin-left:2px; }

/* Panels */
.ops-panel, .ops-feed{
  border:1px solid var(--line); background:var(--panel); padding:12px 14px; min-width:0;
}
.ops-panel-title{
  margin:0 0 10px; font-size:10px; letter-spacing:0.24em; color:var(--cyan-soft);
  display:flex; align-items:center; gap:8px;
}
.ops-empty{ font-size:11px; color:var(--dim); margin:6px 0; }

/* Location list */
.ops-loclist{ display:flex; flex-direction:column; gap:8px; }
.ops-locrow{ display:grid; grid-template-columns:84px 1fr 44px; align-items:center; gap:8px; }
.ops-locname{ font-size:11px; color:var(--txt); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ops-locbar{ height:6px; background:rgba(34,211,238,0.1); border:1px solid var(--line); }
.ops-locbar-fill{ height:100%; background:linear-gradient(90deg, rgba(34,211,238,0.5), var(--cyan)); box-shadow:0 0 8px var(--cyan-soft); }
.ops-loccount{ font-size:11px; text-align:right; color:#eafdff; }

/* Map */
.ops-mapwrap{
  position:relative; border:1px solid var(--line); background:
    radial-gradient(120% 120% at 50% 0%, rgba(34,211,238,0.08), transparent 55%),
    rgba(4,10,16,0.6);
  min-height:420px; display:flex; align-items:center; justify-content:center; overflow:hidden;
}
@media(min-width:1024px){ .ops-mapwrap{ min-height:0; } }
.ops-radar{ position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; padding:10px; }
.ops-svg{ width:100%; height:100%; max-height:78vh; }
.ops-grid path{ fill:none; stroke:rgba(34,211,238,0.13); stroke-width:0.5; }
.ops-land{ fill:rgba(34,211,238,0.07); stroke:none; }
.ops-land-stroke{ fill:none; stroke:var(--cyan); stroke-width:1.1; stroke-linejoin:round; filter:drop-shadow(0 0 6px rgba(34,211,238,0.6)); opacity:0.85; }
.ops-core{ fill:#6fd9e8; }
.ops-core-live{ fill:#eafdff; filter:drop-shadow(0 0 5px var(--lime)); }
.ops-ring{ fill:none; stroke:var(--lime); stroke-width:1; opacity:0; animation:ops-ping 2.4s ease-out infinite; transform-box:fill-box; transform-origin:center; }
.ops-blip-label{ fill:#bfeefb; font-size:8px; letter-spacing:0.12em; }

.ops-sweep{
  position:absolute; inset:0; pointer-events:none; border-radius:50%;
  background:conic-gradient(from 0deg, rgba(34,211,238,0.22), transparent 28%, transparent 100%);
  -webkit-mask:radial-gradient(circle at 50% 50%, #000 0 62%, transparent 63%);
  mask:radial-gradient(circle at 50% 50%, #000 0 62%, transparent 63%);
  animation:ops-spin 7s linear infinite; opacity:0.55;
}
.ops-scan{ position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(180deg, transparent, rgba(34,211,238,0.10), transparent);
  height:40%; animation:ops-scanmove 5.5s linear infinite; }
.ops-corner{ position:absolute; width:18px; height:18px; border:2px solid var(--cyan); z-index:5; opacity:0.7; }
.ops-corner-tl{ top:8px; left:8px; border-right:0; border-bottom:0; }
.ops-corner-tr{ top:8px; right:8px; border-left:0; border-bottom:0; }
.ops-corner-bl{ bottom:8px; left:8px; border-right:0; border-top:0; }
.ops-corner-br{ bottom:8px; right:8px; border-left:0; border-top:0; }
.ops-maplabel{ position:absolute; bottom:12px; left:50%; transform:translateX(-50%);
  font-size:9px; letter-spacing:0.22em; color:var(--cyan-soft); z-index:5; white-space:nowrap; }

/* Feed */
.ops-feed{ display:flex; flex-direction:column; }
.ops-feed-dot{ width:6px; height:6px; border-radius:50%; background:var(--lime); box-shadow:0 0 8px var(--lime); animation:ops-blink 1.4s infinite; }
.ops-feedlist{ display:flex; flex-direction:column; gap:1px; overflow-y:auto; max-height:62vh; }
.ops-feedrow{ display:flex; align-items:center; gap:9px; padding:7px 4px; border-bottom:1px solid rgba(34,211,238,0.07); }
.ops-feed-led{ width:7px; height:7px; border-radius:50%; background:var(--dim); flex-shrink:0; }
.ops-feed-led-live{ background:var(--lime); box-shadow:0 0 8px var(--lime); }
.ops-feed-main{ display:flex; flex-direction:column; min-width:0; flex:1; }
.ops-feed-name{ font-size:12px; color:#eafdff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ops-feed-meta{ font-size:9.5px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ops-feed-time{ font-size:10px; color:var(--dim); flex-shrink:0; }

@keyframes ops-blink{ 0%,100%{opacity:1} 50%{opacity:0.3} }
@keyframes ops-spin{ to{ transform:rotate(360deg) } }
@keyframes ops-ping{ 0%{ transform:scale(0.5); opacity:0.8 } 100%{ transform:scale(2.4); opacity:0 } }
@keyframes ops-scanmove{ 0%{ transform:translateY(-110%) } 100%{ transform:translateY(260%) } }
@media (prefers-reduced-motion: reduce){
  .ops-sweep,.ops-scan,.ops-ring,.ops-led-live,.ops-feed-dot{ animation:none; }
}
`
