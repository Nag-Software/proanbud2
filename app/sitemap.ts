import type { MetadataRoute } from "next"
import { APP_BASE_URL } from "@/lib/constants"

/**
 * Sitemap for app-domenet.
 *
 * NB: sidene under bor i DENNE appen (app.proanbud.no), ikke på apex. Tidligere
 * bygde denne fila alle URLer på proanbud.no — og alle fem 404-et, fordi apex
 * serveres av markedsside-prosjektet. En sitemap full av 404 får Google til å
 * miste tilliten til hele fila, så det undergravde også de sidene som fantes.
 *
 * /verktoy står bevisst IKKE her: de sidene serveres på proanbud.no via
 * multi-zone-rewrite og er meldt inn i markedssidens egen sitemap, som er den
 * Google leser for det domenet.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (
    path: string,
    changeFrequency: "weekly" | "monthly" | "yearly",
    priority: number
  ) => ({
    url: `${APP_BASE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  })

  return [
    page("/kalkulator", "weekly", 0.8),
    page("/login", "monthly", 0.5),
    page("/signup", "monthly", 0.5),
    page("/terms", "yearly", 0.3),
    page("/privacy", "yearly", 0.3),
  ]
}
