import type { MetadataRoute } from "next"

import { APP_BASE_URL } from "@/lib/constants"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/sjefen", "/sjefen/", "/selger", "/selger/"],
    },
    // Dette domenets egen sitemap. Pekte før på proanbud.no/sitemap.xml, som er
    // markedssidens fil på et annet vertsnavn — app-domenets sider ble dermed
    // aldri meldt inn noe sted.
    sitemap: `${APP_BASE_URL}/sitemap.xml`,
  }
}
