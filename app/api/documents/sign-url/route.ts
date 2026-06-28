import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

/**
 * Mint fresh signed URLs on demand for the given Supabase file ids.
 * Used when opening/previewing/downloading a file (and to refresh URLs that
 * may have expired during a long session). RLS-scoped: only the caller's rows.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const provider = (body?.provider as string | undefined) ?? "supabase"
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string") : []

  if (provider !== "supabase") {
    return NextResponse.json({ error: "unsupported_provider" }, { status: 400 })
  }
  if (ids.length === 0) {
    return NextResponse.json({ urls: {} })
  }

  const { data, error } = await supabase
    .from("document_items")
    .select("id,storage_bucket,storage_path")
    .eq("user_id", user.id)
    .eq("provider", "supabase")
    .eq("item_type", "file")
    .in("id", ids.slice(0, 200))

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (data ?? []) as { id: string; storage_bucket: string | null; storage_path: string | null }[]

  // Group paths by bucket and remember which id owns each path.
  const byBucket = new Map<string, string[]>()
  const idByPath = new Map<string, string>()
  for (const row of rows) {
    if (!row.storage_bucket || !row.storage_path) continue
    const paths = byBucket.get(row.storage_bucket) ?? []
    paths.push(row.storage_path)
    byBucket.set(row.storage_bucket, paths)
    idByPath.set(row.storage_path, row.id)
  }

  const urls: Record<string, string> = {}
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, paths]) => {
      const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(paths, 60 * 60)
      for (const entry of signed ?? []) {
        const id = entry.path ? idByPath.get(entry.path) : undefined
        if (id && entry.signedUrl) urls[id] = entry.signedUrl
      }
    })
  )

  return NextResponse.json({ urls })
}
