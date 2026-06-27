import {
  getSanityApiVersion,
  getSanityDataset,
  getSanityProjectId,
  getSanityWriteToken,
} from "@/lib/sanity/config"
import { sanityFetch } from "@/lib/sanity/api"
import { logServerError } from "@/lib/errors/log"

type StockImageCandidate = {
  url: string
  sourceName: string
  sourceId: string
  creditLine?: string
  mimeType?: string
  filename?: string
  relevanceText?: string
  matchedQuery?: string
}

type UsedImageSources = {
  sourceKeys: Set<string>
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])

const MAX_IMAGE_UPLOAD_ATTEMPTS = 12
const MIN_RELEVANCE_SCORE = 2

const USED_IMAGE_SOURCES_QUERY = `
{
  "sources": *[_type == "sanity.imageAsset" && defined(source.id)]{
    "name": source.name,
    "id": source.id
  }
}
`

function buildSourceKey(sourceName: string, sourceId: string) {
  return `${sourceName}:${sourceId}`
}

function shuffleCandidates<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swapIndex]!
    copy[swapIndex] = current!
  }
  return copy
}

function isSupportedMimeType(mimeType?: string | null) {
  if (!mimeType) return false
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase())
}

function detectImageMimeType(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer.slice(0, 12))

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png"
  }

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif"
  }

  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }

  return null
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    default:
      return "jpg"
  }
}

function tokenizeForRelevance(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3)
}

function buildRelevantSearchQueries(input: {
  searchQuery: string
  title: string
  keywords: string[]
  brief?: string
  imageAlt?: string
}) {
  const queries: string[] = []

  const addQuery = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || queries.includes(trimmed)) return
    queries.push(trimmed)
  }

  addQuery(input.searchQuery)
  addQuery(`${input.searchQuery} construction`)
  addQuery(`${input.searchQuery} building site`)

  if (input.imageAlt) {
    addQuery(input.imageAlt)
    addQuery(`${input.imageAlt} construction`)
  }

  if (input.brief) {
    addQuery(input.brief)
  }

  addQuery(input.keywords.slice(0, 3).join(" "))
  addQuery(`${input.keywords.slice(0, 2).join(" ")} construction`)

  const titleWords = input.title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 5)
    .join(" ")

  addQuery(titleWords)

  return queries
}

function buildBroadenedSearchQueries(searchQuery: string, imageAlt?: string) {
  const queries: string[] = []
  const addQuery = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || queries.includes(trimmed)) return
    queries.push(trimmed)
  }

  const terms = [
    ...tokenizeForRelevance(searchQuery),
    ...tokenizeForRelevance(imageAlt || ""),
  ]

  for (const term of [...new Set(terms)].slice(0, 6)) {
    addQuery(`${term} construction`)
    addQuery(`${term} building site`)
    addQuery(`${term} construction worker`)
  }

  if (terms.length >= 2) {
    addQuery(`${terms.slice(0, 3).join(" ")} construction`)
  }

  return queries
}

async function generateEnglishImageSearchQueries(input: {
  brief?: string
  searchQuery: string
  title: string
  keywords: string[]
  imageAlt?: string
}) {
  if (!process.env.OPENAI_API_KEY) {
    return buildBroadenedSearchQueries(input.searchQuery, input.imageAlt)
  }

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini"
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Return only JSON. Create concise English stock photo search queries for construction industry articles.",
        },
        {
          role: "user",
          content: `Create 6 specific English stock photo search queries for this article.

Brief: ${input.brief || "(none)"}
Title: ${input.title}
Keywords: ${input.keywords.join(", ")}
Image search hint: ${input.searchQuery}
Image alt: ${input.imageAlt || "(none)"}

Return:
{ "queries": ["query 1", "query 2"] }

Rules:
- English only
- Each query 2-5 words
- Must describe a concrete photo scene relevant to the article
- Prefer construction, building, contractors, jobsite context when relevant`,
        },
      ],
    }),
  })

  if (!response.ok) {
    return buildBroadenedSearchQueries(input.searchQuery, input.imageAlt)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }

  const raw = payload.choices?.[0]?.message?.content
  if (!raw) {
    return buildBroadenedSearchQueries(input.searchQuery, input.imageAlt)
  }

  try {
    const parsed = JSON.parse(raw) as { queries?: string[] }
    const queries = (parsed.queries ?? [])
      .map((query) => query.trim())
      .filter((query) => query.length > 0)

    return queries.length > 0 ? queries : buildBroadenedSearchQueries(input.searchQuery, input.imageAlt)
  } catch (error) {
    await logServerError({
      message: "Klarte ikke parse AI-genererte bildesøk – bruker fallback-spørringer",
      error,
      source: "server",
      route: "lib/sanity/images.ts:generateEnglishImageSearchQueries",
      level: "warning",
    })
    return buildBroadenedSearchQueries(input.searchQuery, input.imageAlt)
  }
}

function buildRelevanceTerms(input: {
  searchQuery: string
  title: string
  keywords: string[]
  brief?: string
  imageAlt?: string
}) {
  const primary = tokenizeForRelevance(input.searchQuery)
  const secondary = [
    ...tokenizeForRelevance(input.title),
    ...input.keywords.flatMap((keyword) => tokenizeForRelevance(keyword)),
    ...tokenizeForRelevance(input.imageAlt || ""),
    ...tokenizeForRelevance(input.brief || ""),
  ]

  return {
    primary: [...new Set(primary)],
    secondary: [...new Set(secondary.filter((term) => !primary.includes(term)))],
  }
}

function scoreCandidateRelevance(
  candidate: StockImageCandidate,
  terms: { primary: string[]; secondary: string[] }
) {
  const text = `${candidate.relevanceText || ""} ${candidate.matchedQuery || ""}`.toLowerCase()
  if (!text.trim()) return 1

  let score = 0

  for (const term of terms.primary) {
    if (text.includes(term)) score += 4
  }

  for (const term of terms.secondary) {
    if (text.includes(term)) score += 1
  }

  return score > 0 ? score : 1
}

function rankCandidatesByRelevance(
  candidates: StockImageCandidate[],
  terms: { primary: string[]; secondary: string[] }
) {
  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreCandidateRelevance(candidate, terms),
  }))

  const stronglyRelevant = scored
    .filter((entry) => entry.score >= MIN_RELEVANCE_SCORE)
    .sort((left, right) => right.score - left.score)

  if (stronglyRelevant.length > 0) {
    const topScore = stronglyRelevant[0]!.score
    return shuffleCandidates(
      stronglyRelevant
        .filter((entry) => entry.score === topScore)
        .map((entry) => entry.candidate)
    )
  }

  const weaklyRelevant = scored
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.candidate)

  if (weaklyRelevant.length > 0) {
    return shuffleCandidates(weaklyRelevant)
  }

  return shuffleCandidates(candidates)
}

function buildWikimediaSearchTerms(query: string) {
  const terms = [query, `${query} construction`, `${query} building`]
  return [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
}

async function getUsedImageSources(): Promise<UsedImageSources> {
  const result = await sanityFetch<{
    sources: Array<{ name: string | null; id: string | null }>
  }>(USED_IMAGE_SOURCES_QUERY)

  const sourceKeys = new Set<string>()
  for (const source of result.sources) {
    if (!source.name || !source.id) continue
    sourceKeys.add(buildSourceKey(source.name, source.id))
  }

  return { sourceKeys }
}

async function searchPexelsImages(query: string): Promise<StockImageCandidate[]> {
  const apiKey = process.env.PEXELS_API_KEY?.trim()
  if (!apiKey) return []

  const url = new URL("https://api.pexels.com/v1/search")
  url.searchParams.set("query", query)
  url.searchParams.set("per_page", "40")
  url.searchParams.set("orientation", "landscape")

  const response = await fetch(url, {
    headers: { Authorization: apiKey },
    cache: "no-store",
  })

  if (!response.ok) return []

  const payload = (await response.json()) as {
    photos?: Array<{
      id: number
      alt?: string
      photographer?: string
      src?: { large2x?: string; large?: string; original?: string }
    }>
  }

  return (payload.photos ?? []).flatMap((photo) => {
    const imageUrl = photo.src?.large2x || photo.src?.large || photo.src?.original
    if (!imageUrl) return []

    return [
      {
        url: imageUrl,
        sourceName: "pexels",
        sourceId: String(photo.id),
        creditLine: photo.photographer ? `Foto: ${photo.photographer} / Pexels` : "Pexels",
        filename: `pexels-${photo.id}.jpg`,
        mimeType: "image/jpeg",
        relevanceText: photo.alt || "",
      },
    ]
  })
}

async function searchOpenverseImages(query: string): Promise<StockImageCandidate[]> {
  const url = new URL("https://api.openverse.org/v1/images/")
  url.searchParams.set("q", query)
  url.searchParams.set("page_size", "40")
  url.searchParams.set("license", "cc0,pdm,by,by-sa")

  const response = await fetch(url, {
    headers: {
      "User-Agent": "ProanbudArticleBot/1.0 (https://proanbud.no; post@proanbud.no)",
    },
    cache: "no-store",
  })

  if (!response.ok) return []

  const payload = (await response.json()) as {
    results?: Array<{
      id: string
      title?: string | null
      url?: string
      foreign_landing_url?: string
      width?: number
      height?: number
      mime_type?: string
      creator?: string | null
      source?: string | null
      tags?: Array<{ name?: string }>
    }>
  }

  return (payload.results ?? []).flatMap((image) => {
    if (!image.url || !image.id) return []
    if ((image.width ?? 0) < 640 || (image.height ?? 0) < 400) return []
    if (!isSupportedMimeType(image.mime_type)) return []
    if (/\.(svg|tif|tiff|bmp)(\?|$)/i.test(image.url)) return []

    const mimeType = image.mime_type!.toLowerCase()
    const extension = extensionForMimeType(mimeType)
    const tagText = (image.tags ?? []).map((tag) => tag.name).filter(Boolean).join(" ")

    return [
      {
        url: image.url,
        sourceName: "openverse",
        sourceId: image.id,
        creditLine: [image.creator, image.source].filter(Boolean).join(" / ") || "Openverse",
        mimeType,
        filename: `openverse-${image.id}.${extension}`,
        relevanceText: [image.title, tagText].filter(Boolean).join(" "),
      },
    ]
  })
}

async function searchWikimediaImages(query: string): Promise<StockImageCandidate[]> {
  const candidates: StockImageCandidate[] = []

  for (const searchTerm of buildWikimediaSearchTerms(query)) {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: searchTerm,
      gsrnamespace: "6",
      gsrlimit: "40",
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata|size",
      iiurlwidth: "1600",
      format: "json",
    })

    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
      headers: {
        "User-Agent": "ProanbudArticleBot/1.0 (https://proanbud.no; post@proanbud.no)",
      },
      cache: "no-store",
    })

    if (!response.ok) continue

    const payload = (await response.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            pageid?: number
            title?: string
            imageinfo?: Array<{
              url?: string
              mime?: string
              width?: number
              extmetadata?: Record<string, { value?: string }>
            }>
          }
        >
      }
    }

    for (const page of Object.values(payload.query?.pages ?? {})) {
      const pageId = page.pageid
      const info = page.imageinfo?.[0]
      if (!pageId || pageId <= 0 || !info?.url || !info.mime) continue
      if (!isSupportedMimeType(info.mime)) continue
      if ((info.width ?? 0) < 640) continue

      const artist = info.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "").trim()
      const credit = info.extmetadata?.Credit?.value?.replace(/<[^>]+>/g, "").trim()
      const mimeType = info.mime.toLowerCase()
      const extension = extensionForMimeType(mimeType)

      candidates.push({
        url: info.url,
        sourceName: "wikimedia",
        sourceId: String(pageId),
        creditLine: [artist, credit].filter(Boolean).join(" / ") || "Wikimedia Commons",
        mimeType,
        filename: `wikimedia-${pageId}.${extension}`,
        relevanceText: page.title?.replace(/^File:/i, "") || "",
      })
    }
  }

  return candidates
}

function dedupeCandidates(candidates: StockImageCandidate[]) {
  const seen = new Set<string>()
  const unique: StockImageCandidate[] = []

  for (const candidate of candidates) {
    const key = buildSourceKey(candidate.sourceName, candidate.sourceId)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(candidate)
  }

  return unique
}

function preferUnusedCandidates(
  candidates: StockImageCandidate[],
  usedSources: UsedImageSources
) {
  const unused = candidates.filter(
    (candidate) =>
      !usedSources.sourceKeys.has(buildSourceKey(candidate.sourceName, candidate.sourceId))
  )

  return unused.length > 0 ? unused : candidates
}

async function searchSourcesForQuery(query: string): Promise<StockImageCandidate[]> {
  const [pexels, openverse, wikimedia] = await Promise.all([
    searchPexelsImages(query),
    searchOpenverseImages(query),
    searchWikimediaImages(query),
  ])

  return [...pexels, ...openverse, ...wikimedia].map((candidate) => ({
    ...candidate,
    matchedQuery: query,
    relevanceText: candidate.relevanceText || query,
  }))
}

async function collectStockImageCandidates(input: {
  searchQuery: string
  title: string
  keywords: string[]
  brief?: string
  imageAlt?: string
}) {
  const primaryQueries = buildRelevantSearchQueries(input)
  let collected: StockImageCandidate[] = []

  for (const query of primaryQueries) {
    collected.push(...(await searchSourcesForQuery(query)))
    if (collected.length >= 8) break
  }

  if (collected.length === 0) {
    const broadenedQueries = buildBroadenedSearchQueries(input.searchQuery, input.imageAlt)
    for (const query of broadenedQueries) {
      collected.push(...(await searchSourcesForQuery(query)))
      if (collected.length >= 8) break
    }
  }

  if (collected.length === 0) {
    const englishQueries = await generateEnglishImageSearchQueries(input)
    for (const query of englishQueries) {
      collected.push(...(await searchSourcesForQuery(query)))
      if (collected.length >= 12) break
    }
  }

  return dedupeCandidates(collected)
}

async function findRelevantStockImages(input: {
  searchQuery: string
  title: string
  keywords: string[]
  brief?: string
  imageAlt?: string
}) {
  const usedSources = await getUsedImageSources()
  const relevanceTerms = buildRelevanceTerms(input)
  const candidates = await collectStockImageCandidates(input)
  const ranked = rankCandidatesByRelevance(candidates, relevanceTerms)

  if (ranked.length === 0) {
    return []
  }

  return preferUnusedCandidates(ranked, usedSources)
}

async function downloadImageBuffer(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "follow",
    headers: {
      "User-Agent": "ProanbudArticleBot/1.0 (https://proanbud.no; post@proanbud.no)",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  })

  if (!response.ok) {
    return null
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength < 10_000) {
    return null
  }

  const mimeType = detectImageMimeType(buffer)
  if (!mimeType) {
    return null
  }

  return { buffer, mimeType }
}

async function sanityUploadImageAsset(
  candidate: StockImageCandidate,
  image: { buffer: ArrayBuffer; mimeType: string }
) {
  const token = getSanityWriteToken()
  if (!token) {
    throw new Error("SANITY_API_WRITE_TOKEN mangler")
  }

  const extension = extensionForMimeType(image.mimeType)
  const params = new URLSearchParams({
    filename: candidate.filename || `${candidate.sourceName}-${candidate.sourceId}.${extension}`,
  })

  if (candidate.creditLine) params.set("creditLine", candidate.creditLine)
  params.set("sourceName", candidate.sourceName)
  params.set("sourceId", candidate.sourceId)
  params.set("sourceUrl", candidate.url)

  const uploadUrl = `https://${getSanityProjectId()}.api.sanity.io/v${getSanityApiVersion()}/assets/images/${getSanityDataset()}?${params.toString()}`

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": image.mimeType,
    },
    body: image.buffer,
  })

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text()
    throw new Error(`Sanity bildeopplasting feilet (${uploadResponse.status}): ${body}`)
  }

  const payload = (await uploadResponse.json()) as {
    document?: { _id?: string }
  }

  const assetRef = payload.document?._id
  if (!assetRef) {
    throw new Error("Sanity returnerte ikke bilde-referanse")
  }

  return assetRef
}

export async function resolveUniqueArticleImage(input: {
  searchQuery: string
  title: string
  keywords: string[]
  alt: string
  brief?: string
}) {
  const candidates = await findRelevantStockImages({
    ...input,
    imageAlt: input.alt,
  })

  if (candidates.length === 0) {
    throw new Error("Fant ikke et relevant bilde for artikkelen")
  }

  for (const candidate of candidates.slice(0, MAX_IMAGE_UPLOAD_ATTEMPTS)) {
    const downloaded = await downloadImageBuffer(candidate.url)
    if (!downloaded) continue

    try {
      const assetRef = await sanityUploadImageAsset(candidate, downloaded)
      return {
        assetRef,
        alt: input.alt,
        sourceName: candidate.sourceName,
        sourceId: candidate.sourceId,
      }
    } catch (error) {
      await logServerError({
        message: "Opplasting av bildekandidat til Sanity feilet – prøver neste kandidat",
        error,
        source: "server",
        route: "lib/sanity/images.ts:resolveUniqueArticleImage",
        level: "warning",
        context: { sourceName: candidate.sourceName, sourceId: candidate.sourceId },
      })
      continue
    }
  }

  throw new Error("Kunne ikke laste opp et gyldig bilde for artikkelen")
}
