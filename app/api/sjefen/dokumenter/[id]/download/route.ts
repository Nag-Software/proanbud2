import { NextResponse } from "next/server"

import { requirePlatformAdminForApi } from "@/lib/auth/require-platform-admin-api"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

// Platform-admin download of a company document: looks up the storage
// location server-side (never trusts client paths) and redirects to a
// short-lived signed URL.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePlatformAdminForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const admin = createAdminClient()

  const { data: document, error } = await admin
    .from("document_items")
    .select("name, item_type, provider, storage_bucket, storage_path, web_url")
    .eq("id", id)
    .maybeSingle()

  if (error || !document) {
    return NextResponse.json({ error: "Dokumentet ble ikke funnet" }, { status: 404 })
  }

  if (document.item_type !== "file") {
    return NextResponse.json({ error: "Mapper kan ikke lastes ned" }, { status: 400 })
  }

  if (document.provider !== "supabase") {
    if (document.web_url) {
      return NextResponse.redirect(document.web_url)
    }
    return NextResponse.json(
      { error: "Dokumentet ligger hos en ekstern leverandør uten nedlastingslenke" },
      { status: 400 }
    )
  }

  if (!document.storage_bucket || !document.storage_path) {
    return NextResponse.json({ error: "Dokumentet mangler lagringssti" }, { status: 404 })
  }

  const { data: signed, error: signError } = await admin.storage
    .from(document.storage_bucket)
    .createSignedUrl(document.storage_path, 300, { download: document.name })

  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: "Kunne ikke lage nedlastingslenke" }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl)
}
