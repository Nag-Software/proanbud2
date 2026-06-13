import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformAdminForApi } from "@/lib/auth/require-platform-admin-api"
import { generateAndPublishArticle } from "@/lib/sanity/articles"
import { getPublicArticleUrl } from "@/lib/sanity/config"

const generateArticleSchema = z.object({
  brief: z
    .string()
    .trim()
    .min(10, "Beskriv hva artikkelen skal handle om (minst 10 tegn)")
    .max(500, "Beskrivelsen er for lang (maks 500 tegn)"),
})

export async function POST(request: Request) {
  const guard = await requirePlatformAdminForApi()
  if (guard.error) return guard.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const parsed = generateArticleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Ugyldig beskrivelse" },
      { status: 400 }
    )
  }

  try {
    const article = await generateAndPublishArticle(parsed.data.brief)

    return NextResponse.json({
      ok: true,
      article: {
        ...article,
        url: getPublicArticleUrl(article.slug),
      },
    })
  } catch (error) {
    console.error("POST /api/sjefen/artikler/generate", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke generere artikkel" },
      { status: 500 }
    )
  }
}
