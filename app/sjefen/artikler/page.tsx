import { ArtiklerClient } from "@/app/sjefen/artikler/artikler-client"
import { logServerError } from "@/lib/errors/log"
import { listSanityArticles, type SanityArticleListItem } from "@/lib/sanity/articles"

export const dynamic = "force-dynamic"

export default async function SjefenArtiklerPage() {
  let articles: SanityArticleListItem[] = []

  try {
    articles = await listSanityArticles()
  } catch (error) {
    console.error("SjefenArtiklerPage", error)
    await logServerError({ message: "Kunne ikke hente Sanity-artikler", error, source: "server", route: "/sjefen/artikler" })
  }

  return <ArtiklerClient initialArticles={articles} />
}
