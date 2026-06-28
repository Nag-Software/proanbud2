import type { DocumentItem, Integration, Provider, SearchHit } from "../types"

const ERROR_MESSAGES: Record<string, string> = {
  folder_exists: "Mappe finnes allerede.",
  folder_not_empty: "Mappen er ikke tom.",
  invalid_name: "Ugyldig navn.",
  missing_file: "Fant ingen fil.",
  item_not_found: "Fant ikke elementet.",
  not_authenticated: "Du er ikke logget inn.",
}

function normalizeError(code: string | undefined, fallback: string) {
  if (!code) return fallback
  return ERROR_MESSAGES[code] ?? code
}

async function parseError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null)
  return new Error(normalizeError(data?.error, fallback))
}

type ListResult = { items: DocumentItem[]; notConnected: boolean }

export async function listItems(
  provider: Provider,
  parentId: string | null,
  signal?: AbortSignal
): Promise<ListResult> {
  const params = new URLSearchParams({ provider })
  if (parentId) params.set("parentId", parentId)
  const res = await fetch(`/api/documents?${params.toString()}`, { signal })
  if (!res.ok) throw await parseError(res, "Kunne ikke laste mappen.")
  const data = await res.json()
  return { items: (data.items ?? []) as DocumentItem[], notConnected: Boolean(data.notConnected) }
}

export async function listRootFolders(provider: Provider, signal?: AbortSignal): Promise<DocumentItem[]> {
  const params = new URLSearchParams({ provider, rootOnly: "true" })
  const res = await fetch(`/api/documents?${params.toString()}`, { signal })
  if (!res.ok) throw await parseError(res, "Kunne ikke laste områder.")
  const data = await res.json()
  return (data.items ?? []) as DocumentItem[]
}

export async function searchItems(
  provider: Provider,
  term: string,
  signal?: AbortSignal
): Promise<SearchHit[]> {
  const params = new URLSearchParams({ provider, search: term })
  const res = await fetch(`/api/documents?${params.toString()}`, { signal })
  if (!res.ok) throw await parseError(res, "Søket feilet.")
  const data = await res.json()
  return (data.items ?? []) as SearchHit[]
}

export async function listIntegrations(signal?: AbortSignal): Promise<Integration[]> {
  const res = await fetch("/api/documents/integrations", { signal })
  if (!res.ok) return []
  const data = await res.json()
  return (data.integrations ?? []) as Integration[]
}

export async function createFolder(
  provider: Provider,
  name: string,
  parentId: string | null
): Promise<DocumentItem | null> {
  const res = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create_folder", provider, name, parentId }),
  })
  if (!res.ok) throw await parseError(res, "Kunne ikke opprette mappe.")
  const data = await res.json().catch(() => null)
  return (data?.item as DocumentItem) ?? null
}

export async function renameItem(provider: Provider, id: string, newName: string): Promise<void> {
  const res = await fetch("/api/documents", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "rename", provider, id, newName }),
  })
  if (!res.ok) throw await parseError(res, "Kunne ikke endre navn.")
}

export async function moveItem(
  provider: Provider,
  id: string,
  targetFolderId: string | null
): Promise<void> {
  const res = await fetch("/api/documents", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "move", provider, id, targetFolderId }),
  })
  if (!res.ok) throw await parseError(res, "Kunne ikke flytte elementet.")
}

export async function deleteItem(provider: Provider, id: string): Promise<void> {
  const res = await fetch(
    `/api/documents?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  )
  if (!res.ok) throw await parseError(res, "Kunne ikke slette elementet.")
}

export async function revokeIntegration(provider: "google_drive" | "onedrive"): Promise<void> {
  const res = await fetch("/api/documents/integrations/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  })
  if (!res.ok) throw await parseError(res, "Kunne ikke koble fra integrasjonen.")
}

/** Batched, on-demand fresh signed URLs for Supabase files. */
export async function signUrls(
  provider: Provider,
  ids: string[]
): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const res = await fetch("/api/documents/sign-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, ids }),
  })
  if (!res.ok) throw await parseError(res, "Kunne ikke hente fillenke.")
  const data = await res.json()
  return (data.urls ?? {}) as Record<string, string>
}

/** Upload a single file with real progress via XHR (fetch can't report upload progress). */
export function uploadFile(
  provider: Provider,
  file: File,
  parentId: string | null,
  onProgress: (pct: number) => void
): { promise: Promise<DocumentItem | null>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<DocumentItem | null>((resolve, reject) => {
    const payload = new FormData()
    payload.set("file", file)
    payload.set("provider", provider)
    if (parentId) payload.set("parentId", parentId)

    xhr.open("POST", "/api/documents")
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText || "{}")
          resolve((data?.item as DocumentItem) ?? null)
        } catch {
          resolve(null)
        }
      } else {
        let code: string | undefined
        try {
          code = JSON.parse(xhr.responseText || "{}")?.error
        } catch {
          code = undefined
        }
        reject(new Error(normalizeError(code, "Opplasting feilet.")))
      }
    }
    xhr.onerror = () => reject(new Error("Nettverksfeil under opplasting."))
    xhr.onabort = () => reject(new Error("Opplasting avbrutt."))
    xhr.send(payload)
  })

  return { promise, abort: () => xhr.abort() }
}

/**
 * Resolve a guaranteed-fresh URL for a file. For Supabase we always re-sign (the
 * cached downloadUrl from a list may have expired during a long session); the cached
 * value is only a fallback if signing fails. External providers use their stored URL.
 */
export async function resolveFileUrl(item: DocumentItem): Promise<string | null> {
  if (item.provider !== "supabase") return item.webUrl ?? item.downloadUrl ?? null
  const urls = await signUrls(item.provider, [item.id]).catch(() => ({}) as Record<string, string>)
  return urls[item.id] ?? item.downloadUrl ?? item.webUrl ?? null
}
