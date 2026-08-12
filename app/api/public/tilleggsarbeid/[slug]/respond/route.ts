import { NextResponse } from "next/server"

import { fetchPublicChangeOrderBySlug } from "@/lib/tilleggsarbeid/change-order"

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const co = await fetchPublicChangeOrderBySlug(slug)
  if (!co) return NextResponse.json({ error: "Finnes ikke" }, { status: 404 })
  if (!co.canRespond) return NextResponse.json({ error: "Allerede besvart" }, { status: 409 })

  await request.json().catch(() => null)

  return NextResponse.json(
    { error: "Denne lenken brukes ikke lenger for godkjenning av ekstrajobber" },
    { status: 410 }
  )
}
