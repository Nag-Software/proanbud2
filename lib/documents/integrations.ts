import { createClient as createServerSupabase } from "@/lib/supabase/server"

export type DocumentProvider = "google_drive" | "onedrive"

type DocumentIntegration = {
  id: string
  user_id: string
  provider: DocumentProvider
  access_token: string
  refresh_token?: string | null
  expires_at?: string | null
  scope?: string | null
}

export type ExternalDocumentItem = {
  provider: DocumentProvider
  externalId: string
  parentId: string | null
  name: string
  itemType: "file" | "folder"
  mimeType: string | null
  sizeBytes: number | null
  webUrl: string | null
  downloadUrl: string | null
  lastModifiedAt: string | null
  checksum: string | null
  metadata: Record<string, unknown>
}

type GoogleDriveApiItem = {
  id: string
  parents?: string[]
  name?: string
  mimeType?: string
  size?: string
  webViewLink?: string
  webContentLink?: string
  modifiedTime?: string
  md5Checksum?: string
  iconLink?: string
  starred?: boolean
}

type OneDriveApiItem = {
  id: string
  name?: string
  size?: number
  webUrl?: string
  lastModifiedDateTime?: string
  eTag?: string
  cTag?: string
  parentReference?: {
    id?: string
  }
  folder?: Record<string, unknown>
  file?: {
    mimeType?: string
    hashes?: {
      quickXorHash?: string
    }
  }
  "@microsoft.graph.downloadUrl"?: string
}

async function getIntegrationForUser(userId: string, provider: DocumentProvider) {
  const supabase = await createServerSupabase()
  const { data } = await supabase
    .from("document_integrations")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", provider)
    .limit(1)
    .single()

  return (data as DocumentIntegration | null) ?? null
}

async function upsertIntegrationTokens(
  userId: string,
  provider: DocumentProvider,
  tokens: {
    access_token?: string
    refresh_token?: string | null
    expires_at?: string | null
    scope?: string | null
    token_type?: string | null
  }
) {
  const supabase = await createServerSupabase()
  await supabase.from("document_integrations").upsert(
    {
      user_id: userId,
      provider,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      scope: tokens.scope,
      token_type: tokens.token_type,
    },
    { onConflict: "user_id,provider" }
  )
}

function shouldRefreshToken(expiresAt?: string | null) {
  if (!expiresAt) return false
  const expiresEpoch = Math.floor(new Date(expiresAt).getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)
  return expiresEpoch - 60 <= now
}

async function refreshGoogleDriveToken(userId: string, integration: DocumentIntegration) {
  if (!integration.refresh_token) return integration

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    refresh_token: integration.refresh_token,
    grant_type: "refresh_token",
  })

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  if (!res.ok) return integration

  const data = await res.json()
  if (!data.access_token) return integration

  const expiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : integration.expires_at ?? null

  await upsertIntegrationTokens(userId, "google_drive", {
    access_token: data.access_token,
    refresh_token: integration.refresh_token,
    expires_at: expiresAt,
    scope: data.scope ?? integration.scope,
    token_type: data.token_type ?? null,
  })

  return {
    ...integration,
    access_token: data.access_token,
    expires_at: expiresAt,
    scope: data.scope ?? integration.scope,
  }
}

async function refreshOneDriveToken(userId: string, integration: DocumentIntegration) {
  if (!integration.refresh_token) return integration

  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
    refresh_token: integration.refresh_token,
    grant_type: "refresh_token",
    scope: "offline_access Files.ReadWrite User.Read",
  })

  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  if (!res.ok) return integration

  const data = await res.json()
  if (!data.access_token) return integration

  const expiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : integration.expires_at ?? null

  const refreshToken = data.refresh_token ?? integration.refresh_token

  await upsertIntegrationTokens(userId, "onedrive", {
    access_token: data.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    scope: data.scope ?? integration.scope,
    token_type: data.token_type ?? null,
  })

  return {
    ...integration,
    access_token: data.access_token,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    scope: data.scope ?? integration.scope,
  }
}

export async function ensureValidDocumentToken(userId: string, provider: DocumentProvider) {
  const integration = await getIntegrationForUser(userId, provider)
  if (!integration) return null

  if (!shouldRefreshToken(integration.expires_at)) return integration

  if (provider === "google_drive") return refreshGoogleDriveToken(userId, integration)
  if (provider === "onedrive") return refreshOneDriveToken(userId, integration)
  return integration
}

function mapGoogleItem(item: GoogleDriveApiItem): ExternalDocumentItem {
  return {
    provider: "google_drive",
    externalId: item.id,
    parentId: item.parents?.[0] ?? null,
    name: item.name ?? "Uten navn",
    itemType: item.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
    mimeType: item.mimeType ?? null,
    sizeBytes: item.size ? Number(item.size) : null,
    webUrl: item.webViewLink ?? null,
    downloadUrl: item.webContentLink ?? null,
    lastModifiedAt: item.modifiedTime ?? null,
    checksum: item.md5Checksum ?? null,
    metadata: {
      iconLink: item.iconLink ?? null,
      starred: item.starred ?? false,
    },
  }
}

function mapOneDriveItem(item: OneDriveApiItem): ExternalDocumentItem {
  return {
    provider: "onedrive",
    externalId: item.id,
    parentId: item.parentReference?.id ?? null,
    name: item.name ?? "Uten navn",
    itemType: item.folder ? "folder" : "file",
    mimeType: item.file?.mimeType ?? null,
    sizeBytes: typeof item.size === "number" ? item.size : null,
    webUrl: item.webUrl ?? null,
    downloadUrl: item["@microsoft.graph.downloadUrl"] ?? null,
    lastModifiedAt: item.lastModifiedDateTime ?? null,
    checksum: item.file?.hashes?.quickXorHash ?? null,
    metadata: {
      eTag: item.eTag ?? null,
      cTag: item.cTag ?? null,
    },
  }
}

export async function listGoogleDriveItems(userId: string, parentId?: string) {
  const integration = await ensureValidDocumentToken(userId, "google_drive")
  if (!integration?.access_token) {
    return { items: [] as ExternalDocumentItem[], notConnected: true }
  }

  const q = `'${parentId ?? "root"}' in parents and trashed = false`
  const params = new URLSearchParams({
    q,
    pageSize: "100",
    orderBy: "folder,name,modifiedTime desc",
    fields:
      "files(id,name,mimeType,size,modifiedTime,webViewLink,webContentLink,parents,md5Checksum,iconLink,starred)",
  })

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    console.error("Google Drive List Error:", errorText)
    return { items: [] as ExternalDocumentItem[], notConnected: false }
  }

  const data = (await res.json()) as { files?: GoogleDriveApiItem[] }
  const items = (data.files ?? []).map(mapGoogleItem)
  return { items, notConnected: false }
}

export async function listOneDriveItems(userId: string, parentId?: string) {
  const integration = await ensureValidDocumentToken(userId, "onedrive")
  if (!integration?.access_token) {
    return { items: [] as ExternalDocumentItem[], notConnected: true }
  }

  const endpoint = parentId
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children`
    : "https://graph.microsoft.com/v1.0/me/drive/root/children"

  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
    },
  })

  if (!res.ok) {
    return { items: [] as ExternalDocumentItem[], notConnected: false }
  }

  const data = (await res.json()) as { value?: OneDriveApiItem[] }
  const items = (data.value ?? []).map(mapOneDriveItem)
  return { items, notConnected: false }
}

export async function renameGoogleDriveItem(userId: string, itemId: string, name: string) {
  const integration = await ensureValidDocumentToken(userId, "google_drive")
  if (!integration?.access_token) return false

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  })

  return res.ok
}

export async function renameOneDriveItem(userId: string, itemId: string, name: string) {
  const integration = await ensureValidDocumentToken(userId, "onedrive")
  if (!integration?.access_token) return false

  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  })

  return res.ok
}

export async function deleteGoogleDriveItem(userId: string, itemId: string) {
  const integration = await ensureValidDocumentToken(userId, "google_drive")
  if (!integration?.access_token) return false

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
    },
  })

  return res.ok
}

export async function deleteOneDriveItem(userId: string, itemId: string) {
  const integration = await ensureValidDocumentToken(userId, "onedrive")
  if (!integration?.access_token) return false

  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
    },
  })

  return res.ok
}

export async function createGoogleDriveFolder(userId: string, name: string, parentId?: string | null) {
  const integration = await ensureValidDocumentToken(userId, "google_drive")
  if (!integration) return null

  const parents = parentId ? [parentId] : []
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents,
    }),
  })

  if (!res.ok) {
    const errorText = await res.text()
    console.error("Google Drive Create Folder Error:", errorText)
    return null
  }
  const data = await res.json()
  return data.id as string
}

export async function createOneDriveFolder(userId: string, name: string, parentId?: string | null) {
  const integration = await ensureValidDocumentToken(userId, "onedrive")
  if (!integration) return null

  const url = parentId
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`
    : `https://graph.microsoft.com/v1.0/me/drive/root/children`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      folder: {},
      "@microsoft.graph.conflictBehavior": "rename",
    }),
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.id as string
}

export async function uploadGoogleDriveFile(userId: string, file: File, parentId?: string | null) {
  const integration = await ensureValidDocumentToken(userId, "google_drive")
  if (!integration) return null

  const parents = parentId ? [parentId] : []
  const metadataRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: file.name,
      parents,
    }),
  })

  if (!metadataRes.ok) {
    const errorText = await metadataRes.text()
    console.error("Google Drive Upload: Metadata Error", errorText)
    return null
  }
  const metadata = await metadataRes.json()
  const fileId = metadata.id

  const bytes = await file.arrayBuffer()
  const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: bytes,
  })

  if (!uploadRes.ok) {
    const uploadErrorText = await uploadRes.text()
    console.error("Google Drive Upload: Media Error", uploadErrorText)
    return null
  }
  return fileId as string
}

export async function uploadOneDriveFile(userId: string, file: File, parentId?: string | null) {
  const integration = await ensureValidDocumentToken(userId, "onedrive")
  if (!integration) return null

  const basePath = parentId
    ? `https://graph.microsoft.com/v1.0/me/drive/items/${parentId}:/${encodeURIComponent(file.name)}:/content`
    : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(file.name)}:/content`

  const bytes = await file.arrayBuffer()
  const res = await fetch(basePath, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: bytes,
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.id as string
}

export async function moveGoogleDriveItem(userId: string, itemId: string, newParentId: string | null) {
  const integration = await ensureValidDocumentToken(userId, "google_drive")
  if (!integration) return false

  // Need to get current parents to remove them
  const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${itemId}?fields=parents`, {
    headers: { Authorization: `Bearer ${integration.access_token}` },
  })
  if (!getRes.ok) return false
  const getJson = await getRes.json()
  const oldParents = (getJson.parents ?? []).join(",")

  const targetParent = newParentId || "root"
  const url = `https://www.googleapis.com/drive/v3/files/${itemId}?addParents=${targetParent}&removeParents=${oldParents}`

  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${integration.access_token}` },
  })

  return res.ok
}

export async function moveOneDriveItem(userId: string, itemId: string, newParentId: string | null) {
  const integration = await ensureValidDocumentToken(userId, "onedrive")
  if (!integration) return false

  // If newParentId is null, we need the root ID for OneDrive, but typically we can pass path /drive/root.
  // Graph API allows sending parentReference: { path: "/drive/root" } if id is not known, 
  // or we can fetch root id. Let's just use `{ path: "/drive/root" }` or `{ id: newParentId }`.
  const parentReference = newParentId ? { id: newParentId } : { "driveId": integration.id /* hacky, better use path */, path: "/drive/root" }
  // actually Graph API allows setting parent folder explicitly:
  const bodyRef = newParentId ? { parentReference: { id: newParentId } } : { parentReference: { path: "/drive/root" } }

  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${itemId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${integration.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyRef),
  })

  return res.ok
}

export async function revokeDocumentIntegration(userId: string, provider: DocumentProvider) {
  const supabase = await createServerSupabase()
  await supabase.from("document_integrations").delete().eq("user_id", userId).eq("provider", provider)
}
