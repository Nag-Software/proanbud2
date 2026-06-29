import { NextResponse } from "next/server"

import { getCurrentUserRole } from "@/lib/auth-utils"
import { canManageProjects } from "@/lib/roles"
import { geocodeAddressMany } from "@/lib/geo/geocode"
import { logServerError } from "@/lib/errors/log"
import type { GeoPoint } from "@/lib/geo/geocode"

// Module-agnostic address autocomplete (Kartverket → MapTiler), used by the map
// to set a project's site address. Admin/manager only — the same surface that
// owns the map. MapTiler runs server-side so its key never reaches the client.

export async function GET(request: Request) {
  const { canonicalRole } = await getCurrentUserRole()
  if (!canManageProjects(canonicalRole)) {
    return NextResponse.json({ results: [] as GeoPoint[] }, { status: 403 })
  }

  const q = (new URL(request.url).searchParams.get("q") || "").trim().slice(0, 200)
  if (q.length < 3) return NextResponse.json({ results: [] as GeoPoint[] })

  try {
    const results = await geocodeAddressMany(q, 6)
    return NextResponse.json({ results })
  } catch (error) {
    await logServerError({
      message: "Geokoding (kart) feilet",
      error,
      source: "api",
      route: "GET /api/geo/geocode",
      context: { q },
    })
    return NextResponse.json({ results: [] as GeoPoint[] })
  }
}
