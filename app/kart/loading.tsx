import { AppPageShell } from "@/components/app-page-shell"

// Instant paint while the force-dynamic map data loads — mirrors the map
// canvas with the floating search/filter chrome so the switch doesn't jump.
export default function Loading() {
  return (
    <AppPageShell segments={["Kart"]} noPadding>
      <div className="relative h-[calc(100dvh-9rem)] min-h-[320px] w-full overflow-hidden">
        <div className="absolute inset-0 animate-pulse bg-muted/50" />
        <div className="absolute left-4 top-4 flex gap-2">
          <div className="h-10 w-64 max-w-[60vw] animate-pulse rounded-lg bg-background/90 shadow" />
          <div className="h-10 w-10 animate-pulse rounded-lg bg-background/90 shadow" />
        </div>
      </div>
    </AppPageShell>
  )
}
