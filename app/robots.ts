import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/sjefen", "/sjefen/", "/selger", "/selger/"],
    },
    // Ingen Sitemap-linje: appen er noindex (app/layout.tsx + X-Robots-Tag i
    // next.config.ts). Allow: / står bevisst — med Disallow: / kan Google ikke
    // crawle sidene og får aldri sett noindex.
  }
}
