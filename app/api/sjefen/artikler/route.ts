import { NextResponse } from "next/server"

import { requirePlatformAdminForApi } from "@/lib/auth/require-platform-admin-api"
import { logServerError } from "@/lib/errors/log"
import { deleteSanityArticle, listSanityArticles } from "@/lib/sanity/articles"

export async function GET() {
  const guard = await requirePlatformAdminForApi()
  if (guard.error) return guard.error

  try {
    const articles = await listSanityArticles()
    return NextResponse.json({ articles })
  } catch (error) {
    console.error("GET /api/sjefen/artikler", error)
    await logServerError({ message: "Kunne ikke hente artikler", error, source: "api", route: "GET /api/sjefen/artikler" })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke hente artikler" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const guard = await requirePlatformAdminForApi()
  if (guard.error) return guard.error

  const { searchParams } = new URL(request.url)
  const id = searchParams.get("id")

  if (!id) {
    return NextResponse.json({ error: "Mangler artikkel-id" }, { status: 400 })
  }

  try {
    await deleteSanityArticle(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("DELETE /api/sjefen/artikler", error)
    await logServerError({ message: "Kunne ikke slette artikkel", error, source: "api", route: "DELETE /api/sjefen/artikler", context: { id } })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke slette artikkel" },
      { status: 500 }
    )
  }
}
