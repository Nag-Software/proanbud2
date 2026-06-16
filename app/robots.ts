import type { MetadataRoute } from "next"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://proanbud.no"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/sjefen", "/sjefen/", "/selger", "/selger/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
