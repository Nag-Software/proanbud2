import { randomUUID } from "crypto"

import {
  getSanityApiVersion,
  getSanityDataset,
  getSanityProjectId,
  getSanityWriteToken,
} from "@/lib/sanity/config"

type SanityQueryResult<T> = {
  result: T
  ms?: number
}

type SanityMutationResult = {
  transactionId: string
  results?: Array<{ id?: string; documentId?: string; operation: string }>
}

function getSanityBaseUrl() {
  return `https://${getSanityProjectId()}.api.sanity.io/v${getSanityApiVersion()}/data`
}

export async function sanityFetch<T>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(`${getSanityBaseUrl()}/query/${getSanityDataset()}`)
  url.searchParams.set("query", query)

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(`$${key}`, JSON.stringify(value))
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 0 },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sanity query failed (${response.status}): ${body}`)
  }

  const payload = (await response.json()) as SanityQueryResult<T>
  return payload.result
}

async function sanityFetchWithToken<T>(
  query: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const token = getSanityWriteToken()
  if (!token) {
    throw new Error("SANITY_API_WRITE_TOKEN mangler")
  }

  const url = new URL(`${getSanityBaseUrl()}/query/${getSanityDataset()}`)
  url.searchParams.set("query", query)

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(`$${key}`, JSON.stringify(value))
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sanity query failed (${response.status}): ${body}`)
  }

  const payload = (await response.json()) as SanityQueryResult<T>
  return payload.result
}

export async function sanityMutate(
  mutations: Array<Record<string, unknown>>
): Promise<SanityMutationResult> {
  const token = getSanityWriteToken()
  if (!token) {
    throw new Error("SANITY_API_WRITE_TOKEN mangler")
  }

  const response = await fetch(`${getSanityBaseUrl()}/mutate/${getSanityDataset()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mutations, returnIds: true }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sanity mutate failed (${response.status}): ${body}`)
  }

  return (await response.json()) as SanityMutationResult
}

function getMutationDocumentId(result: SanityMutationResult) {
  const entry = result.results?.[0]
  return entry?.documentId ?? entry?.id
}

export async function sanityCreateDocument<T extends Record<string, unknown>>(document: T) {
  const id =
    typeof document._id === "string" && document._id.trim().length > 0
      ? document._id.trim()
      : randomUUID()

  const result = await sanityMutate([{ create: { ...document, _id: id } }])
  const createdId = getMutationDocumentId(result) ?? id

  if (!createdId) {
    throw new Error("Sanity opprettet ikke dokumentet som forventet")
  }

  return createdId
}

async function findReferencingDocumentIds(targetId: string) {
  const [byReference, byArticleViewDailyId] = await Promise.all([
    sanityFetchWithToken<string[]>(`*[references($targetId)][]._id`, { targetId }),
    sanityFetchWithToken<string[]>(
      `*[_type == "articleViewDaily" && _id match "articleViewDaily." + $targetId + "*"][]._id`,
      { targetId }
    ),
  ])

  return [...new Set([...byReference, ...byArticleViewDailyId])]
}

export async function sanityDeleteDocument(id: string) {
  const referencingIds = await findReferencingDocumentIds(id)

  if (referencingIds.length > 0) {
    await sanityMutate(referencingIds.map((referencingId) => ({ delete: { id: referencingId } })))
  }

  await sanityMutate([{ delete: { id } }])
}
