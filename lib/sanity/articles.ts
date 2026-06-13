import { z } from "zod"

import {
  assertSanityWriteConfig,
  getSanityDefaultAuthorId,
} from "@/lib/sanity/config"
import { sanityCreateDocument, sanityDeleteDocument, sanityFetch } from "@/lib/sanity/api"
import { resolveUniqueArticleImage } from "@/lib/sanity/images"
import {
  sectionsToPortableText,
  slugifyTitle,
  type GeneratedArticleSection,
} from "@/lib/sanity/portable-text"

export type SanityArticleListItem = {
  _id: string
  title: string
  slug: string
  excerpt: string | null
  publishedAt: string | null
  seoTitle: string | null
  seoDescription: string | null
  keywords: string[] | null
}

const generatedSectionSchema = z.object({
  type: z.enum(["paragraph", "h2", "h3", "bullet"]),
  text: z.string().trim().min(1),
})

const MAX_SECTIONS = 80
const MAX_TITLE_LENGTH = 60
const MAX_EXCERPT_LENGTH = 200

const generatedArticleSchema = z.object({
  title: z.string().trim().min(8).max(MAX_TITLE_LENGTH),
  slug: z.string().trim().min(3).max(120),
  excerpt: z.string().trim().min(30).max(MAX_EXCERPT_LENGTH),
  seoTitle: z.string().trim().min(8).max(70),
  seoDescription: z.string().trim().min(40).max(170),
  keywords: z.array(z.string().trim().min(2)).min(3).max(8),
  mainImageAlt: z.string().trim().min(8).max(120),
  mainImageSearchQuery: z.string().trim().min(3).max(80),
  sections: z.array(generatedSectionSchema).min(6).max(MAX_SECTIONS),
})

const ARTICLE_LIST_QUERY = `
  *[_type == "article"] | order(publishedAt desc) {
    _id,
    title,
    "slug": slug.current,
    excerpt,
    publishedAt,
    seoTitle,
    seoDescription,
    keywords
  }
`

const ARTICLE_TITLES_QUERY = `
  *[_type == "article"] | order(publishedAt desc)[0...50].title
`

const ARTICLE_SLUGS_QUERY = `
  *[_type == "article"].slug.current
`

function normalizeJsonFromModel(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return "{}"

  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }

  return trimmed
}

function truncateToMax(value: unknown, max: number) {
  if (typeof value !== "string") return value

  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed

  const truncated = trimmed.slice(0, max)
  const lastSpace = truncated.lastIndexOf(" ")
  if (lastSpace > max * 0.6) {
    return truncated.slice(0, lastSpace).trim()
  }

  return truncated.trim()
}

function sanitizeGeneratedArticleInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input
  }

  const obj = input as Record<string, unknown>
  const sections = Array.isArray(obj.sections) ? obj.sections.slice(0, MAX_SECTIONS) : obj.sections
  const keywords = Array.isArray(obj.keywords) ? obj.keywords.slice(0, 8) : obj.keywords
  const fallbackSearchQuery = Array.isArray(obj.keywords)
    ? obj.keywords.slice(0, 3).join(" ")
    : "construction technology"

  return {
    ...obj,
    title: truncateToMax(obj.title, MAX_TITLE_LENGTH),
    slug: truncateToMax(obj.slug, 120),
    excerpt: truncateToMax(obj.excerpt, MAX_EXCERPT_LENGTH),
    seoTitle: truncateToMax(obj.seoTitle, 70),
    seoDescription: truncateToMax(obj.seoDescription, 170),
    mainImageAlt: truncateToMax(obj.mainImageAlt, 120),
    mainImageSearchQuery: truncateToMax(
      typeof obj.mainImageSearchQuery === "string" && obj.mainImageSearchQuery.trim()
        ? obj.mainImageSearchQuery
        : fallbackSearchQuery,
      80
    ),
    keywords,
    sections,
  }
}

export async function listSanityArticles(): Promise<SanityArticleListItem[]> {
  return sanityFetch<SanityArticleListItem[]>(ARTICLE_LIST_QUERY)
}

export async function deleteSanityArticle(id: string) {
  await sanityDeleteDocument(id)
}

export async function generateAndPublishArticle(brief: string) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY mangler")
  }

  assertSanityWriteConfig()

  const existingTitles = await sanityFetch<string[]>(ARTICLE_TITLES_QUERY)
  const existingSlugs = await sanityFetch<string[]>(ARTICLE_SLUGS_QUERY)
  const generated = await generateArticleWithOpenAi(existingTitles, brief)
  const publishedAt = new Date().toISOString()
  const slug = ensureUniqueSlug(slugifyTitle(generated.slug || generated.title), existingSlugs)

  const body = sectionsToPortableText(generated.sections)
  if (body.length === 0) {
    throw new Error("AI returnerte tomt artikkelinnhold")
  }

  const mainImage = await resolveUniqueArticleImage({
    searchQuery: generated.mainImageSearchQuery,
    title: generated.title,
    keywords: generated.keywords,
    alt: generated.mainImageAlt,
    brief,
  })

  const document = {
    _type: "article",
    title: generated.title,
    slug: {
      _type: "slug",
      current: slug,
    },
    excerpt: generated.excerpt,
    seoTitle: generated.seoTitle,
    seoDescription: generated.seoDescription,
    keywords: generated.keywords,
    publishedAt,
    author: {
      _type: "reference",
      _ref: getSanityDefaultAuthorId(),
    },
    mainImage: {
      _type: "image",
      alt: mainImage.alt,
      asset: {
        _type: "reference",
        _ref: mainImage.assetRef,
      },
    },
    body,
  }

  const id = await sanityCreateDocument(document)

  return {
    id,
    slug,
    title: generated.title,
    publishedAt,
  }
}

async function generateArticleWithOpenAi(existingTitles: string[], brief: string) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini"

  const systemPrompt = `Du er redaktør for Proanbud, en norsk plattform for byggebransjen.
Skriv en faglig, konkret og SEO-vennlig artikkel på norsk bokmål.
Artikkelen skal være praktisk relevant for små og mellomstore entreprenører og håndverksbedrifter.
Unngå hype og generiske fraser. Gi konkrete eksempler og tydelig struktur.
Returner KUN gyldig JSON uten markdown.`

  const userPrompt = `Skriv en ny artikkel basert på denne beskrivelsen fra redaktøren:

«${brief}»

Unngå disse titlene som allerede finnes:
${existingTitles.map((title) => `- ${title}`).join("\n") || "- (ingen)"}

Returner JSON med denne strukturen:
{
  "title": "string",
  "slug": "url-vennlig-slug",
  "excerpt": "kort ingress (maks 200 tegn)",
  "seoTitle": "SEO-tittel",
  "seoDescription": "meta description",
  "keywords": ["keyword1", "keyword2"],
  "mainImageAlt": "presis alt-tekst som beskriver det konkrete bildet",
  "mainImageSearchQuery": "3-6 engelske søkeord for ett konkret, relevant foto",
  "sections": [
    { "type": "paragraph", "text": "..." },
    { "type": "h2", "text": "..." },
    { "type": "bullet", "text": "..." }
  ]
}

Krav:
- Følg redaktørens beskrivelse tett — dette er hovedtemaet
- title: maks ${MAX_TITLE_LENGTH} tegn
- excerpt (ingress): maks ${MAX_EXCERPT_LENGTH} tegn
- 900-1400 ord totalt
- Minst 4 h2-overskrifter
- Minst 4 punktlister (bullet)
- Ingen HTML, kun ren tekst i sections
- slug skal være unik og url-vennlig
- seoDescription: maks 170 tegn
- seoTitle: maks 70 tegn
- sections: maks ${MAX_SECTIONS} elementer (bruk færre, lengre avsnitt der det er mulig)
- mainImageSearchQuery: konkrete engelske søkeord som beskriver ETT spesifikt foto som passer artikkelens innhold. Må være direkte relevant — ikke generisk "construction" alene
- mainImageAlt: beskriv nøyaktig hva hovedbildet viser, i tråd med artikkelens tema`

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI feilet (${response.status}): ${body}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }

  const raw = payload.choices?.[0]?.message?.content
  if (!raw) {
    throw new Error("OpenAI returnerte tomt svar")
  }

  const parsed = JSON.parse(normalizeJsonFromModel(raw))
  return generatedArticleSchema.parse(sanitizeGeneratedArticleInput(parsed))
}

function ensureUniqueSlug(baseSlug: string, existingSlugs: string[]) {
  const normalizedExisting = new Set(existingSlugs.map((slug) => slug.toLowerCase()))
  if (!normalizedExisting.has(baseSlug)) {
    return baseSlug
  }

  for (let index = 2; index <= 20; index += 1) {
    const candidate = `${baseSlug}-${index}`
    if (!normalizedExisting.has(candidate)) {
      return candidate
    }
  }

  return `${baseSlug}-${Date.now()}`
}

export type { GeneratedArticleSection }
