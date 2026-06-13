import { ArtiklerClient } from "@/app/sjefen/artikler/artikler-client"
import { listSanityArticles, type SanityArticleListItem } from "@/lib/sanity/articles"

export const dynamic = "force-dynamic"

export default async function SjefenArtiklerPage() {
  let articles: SanityArticleListItem[] = []

  try {
    articles = await listSanityArticles()
  } catch (error) {
    console.error("SjefenArtiklerPage", error)
  }

  return <ArtiklerClient initialArticles={articles} />
}
