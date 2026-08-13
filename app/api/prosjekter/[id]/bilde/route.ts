import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getPlaceImage, normalizeAddress, type PlaceQuery } from "@/lib/geo/place-image"
import { logServerError } from "@/lib/errors/log"

// Bilde av byggeplassen til et prosjekt, hentet fra adressen. Ruten finnes for at
// kortene skal slippe å kjenne til adressen eller nøkkelen: klienten ber bare om
// prosjekt-id-en, og RLS avgjør om brukeren får se noe i det hele tatt.

type RouteContext = { params: Promise<{ id: string }> }

// Nettleseren beholder bildet et døgn, så bla-fram-og-tilbake i prosjektlista
// treffer ikke funksjonen. `private` fordi adressen til en byggeplass ikke skal
// ligge i en delt CDN-cache.
const BROWSER_CACHE = "private, max-age=86400, stale-while-revalidate=604800"
// Bom caches ALDRI. En 404 her betyr som regel noe forbigående — Kartverket nede,
// en timeout, en skrivefeil i adressen som blir rettet — og en cachet 404 fryser
// kortet tomt til cachen løper ut, uten annen utvei enn hard refresh. Kostnaden
// ved å la den gå på nytt er null: har prosjektet ingen adresse spør klienten
// aldri, og selve leverandørkallene dedupes uansett i Next sin data-cache.
const MISS_CACHE = "no-store"

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return new NextResponse(null, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })

  try {
    const { data: project } = await supabase
      .from("projects")
      .select("id, site_address, lat, lng, customers(address, postal_code, city, lat, lng)")
      .eq("id", id)
      .maybeSingle()

    if (!project) return new NextResponse(null, { status: 404 })

    const candidates = resolveSiteQueries(project)
    if (candidates.length === 0) {
      return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } })
    }

    const image = await getPlaceImage(candidates)
    if (!image) {
      return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } })
    }

    return new NextResponse(image.body, {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": BROWSER_CACHE,
        "X-Place-Image-Source": image.source,
      },
    })
  } catch (error) {
    await logServerError({
      message: "Kunne ikke hente stedsbilde for prosjekt",
      error,
      source: "api",
      route: "GET /api/prosjekter/[id]/bilde",
      context: { projectId: id },
    })
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": MISS_CACHE } })
  }
}

type SiteRow = {
  site_address: string | null
  lat: number | null
  lng: number | null
  customers?:
    | { address?: string | null; postal_code?: string | null; city?: string | null; lat?: number | null; lng?: number | null }
    | { address?: string | null; postal_code?: string | null; city?: string | null; lat?: number | null; lng?: number | null }[]
    | null
}

/**
 * Adressene vi prøver, i prioritert rekkefølge: prosjektets egen byggeplass
 * først (samme rekkefølge som /kart bruker for pinnene), kundens adresse som
 * reserve når byggeplassadressen er skrevet på slump.
 *
 * Gatenavn alene er ikke nok — «Marcus Thranes veg 12» finnes i både Vennesla
 * og Lillehammer — så postnummeret fra kunden lånes inn når byggeplassadressen
 * mangler det.
 */
function resolveSiteQueries(project: SiteRow): PlaceQuery[] {
  const customer = Array.isArray(project.customers) ? project.customers[0] : project.customers
  const postalPlace = [customer?.postal_code, customer?.city].filter(Boolean).join(" ").trim()

  const queries: PlaceQuery[] = []

  const own = normalizeAddress(project.site_address)
  if (own) {
    const hasPostal = /\b\d{4}\b/.test(own)
    queries.push({
      address: hasPostal || !postalPlace ? own : `${own}, ${postalPlace}`,
      lat: project.lat,
      lng: project.lng,
    })
  }

  const fromCustomer = normalizeAddress([customer?.address, postalPlace].filter(Boolean).join(", "))
  if (fromCustomer && fromCustomer !== queries[0]?.address) {
    queries.push({
      address: fromCustomer,
      lat: customer?.lat ?? null,
      lng: customer?.lng ?? null,
    })
  }

  return queries
}
