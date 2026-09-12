// Google Places (valgfri).
//
// For B2C-håndverkere er anmeldelsene det mest personlige vi kan finne: «4,9 av
// 5 på 63 anmeldelser» er en ekte grunn til å ta kontakt, og utdragene er ofte
// konkrete nok til å bli en krok.
//
// Krever at Places API er skrudd på for GOOGLE_MAPS_API_KEY og at
// SALG_PLACES=on. Er noe av det ikke på plass, returnerer modulen null uten å
// klage — den er et pluss, ikke et krav.

import { logServerError } from "@/lib/errors/log"

const SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"

export type PlacesReview = {
  text: string
  rating: number | null
  /** ISO-dato, når Google oppgir den. */
  published: string | null
}

export type PlacesResult = {
  name: string
  rating: number | null
  review_count: number | null
  maps_url: string | null
  website: string | null
  reviews: PlacesReview[]
  source_url: string
}

export function placesEnabled(): boolean {
  return (
    process.env.SALG_PLACES?.trim().toLowerCase() === "on" &&
    Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim())
  )
}

type PlacesPayload = {
  places?: Array<{
    displayName?: { text?: string }
    rating?: number
    userRatingCount?: number
    googleMapsUri?: string
    websiteUri?: string
    reviews?: Array<{
      text?: { text?: string }
      rating?: number
      publishTime?: string
    }>
  }>
}

export async function fetchPlaces(input: {
  companyName: string
  city?: string | null
}): Promise<PlacesResult | null> {
  if (!placesEnabled()) return null
  const apiKey = process.env.GOOGLE_MAPS_API_KEY!.trim()
  const query = [input.companyName, input.city].filter(Boolean).join(" ")

  try {
    const response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.websiteUri,places.reviews",
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "no",
        regionCode: "NO",
        maxResultCount: 1,
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) return null
    const payload = (await response.json()) as PlacesPayload
    const place = payload.places?.[0]
    if (!place) return null

    return {
      name: place.displayName?.text || input.companyName,
      rating: typeof place.rating === "number" ? place.rating : null,
      review_count: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
      maps_url: place.googleMapsUri || null,
      website: place.websiteUri || null,
      reviews: (place.reviews ?? [])
        .map((review) => ({
          text: (review.text?.text || "").trim(),
          rating: typeof review.rating === "number" ? review.rating : null,
          published: review.publishTime || null,
        }))
        .filter((review) => review.text)
        .slice(0, 5),
      source_url: place.googleMapsUri || SEARCH_URL,
    }
  } catch (error) {
    void logServerError({
      message: "Google Places-oppslag feilet",
      level: "warning",
      source: "worker",
      error,
      context: { query },
    })
    return null
  }
}
