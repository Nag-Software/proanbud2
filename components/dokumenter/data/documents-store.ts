"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { fileExtension, folderCacheKey } from "../utils"
import * as api from "./api"
import type { DocumentItem, Integration, Provider, SearchHit } from "../types"

export type FolderState = {
  status: "loading" | "success" | "error"
  items: DocumentItem[]
  notConnected: boolean
  error: string | null
  fetchedAt: number
}

const EMPTY_FOLDER: FolderState = Object.freeze({
  status: "loading",
  items: Object.freeze([]) as unknown as DocumentItem[],
  notConnected: false,
  error: null,
  fetchedAt: 0,
})
const EMPTY_ROOT: DocumentItem[] = Object.freeze([]) as unknown as DocumentItem[]
const EMPTY_INTEGRATIONS: Integration[] = Object.freeze([]) as unknown as Integration[]

const STALE_MS = 30_000
const MAX_KEYS = 60

// ---- module-level store (outside React) ----
const folderCache = new Map<string, FolderState>()
const rootCache = new Map<Provider, { items: DocumentItem[]; fetchedAt: number }>()
let integrationsState: { value: Integration[]; fetchedAt: number } = {
  value: EMPTY_INTEGRATIONS,
  fetchedAt: 0,
}

const inFlight = new Map<string, AbortController>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}
function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function writeFolder(key: string, state: FolderState) {
  // delete+set so the Map keeps most-recently-used at the tail
  folderCache.delete(key)
  folderCache.set(key, state)
  if (folderCache.size > MAX_KEYS) {
    const oldest = folderCache.keys().next().value
    if (oldest && oldest !== key) folderCache.delete(oldest)
  }
}

function getFolderSnapshot(key: string): FolderState {
  return folderCache.get(key) ?? EMPTY_FOLDER
}

// ---- fetching (stale-while-revalidate, deduped) ----
async function fetchFolder(provider: Provider, parentId: string | null, key: string) {
  if (inFlight.has(key)) return
  const controller = new AbortController()
  inFlight.set(key, controller)

  const existing = folderCache.get(key)
  if (!existing) {
    writeFolder(key, { ...EMPTY_FOLDER, status: "loading" })
    emit()
  }

  try {
    const { items, notConnected } = await api.listItems(provider, parentId, controller.signal)
    writeFolder(key, { status: "success", items, notConnected, error: null, fetchedAt: Date.now() })
    if (parentId === null) {
      rootCache.set(provider, {
        items: items.filter((i) => i.itemType === "folder"),
        fetchedAt: Date.now(),
      })
    }
    emit()
  } catch (e) {
    if (controller.signal.aborted) return
    writeFolder(key, {
      status: "error",
      items: existing?.items ?? [],
      notConnected: false,
      error: (e as Error).message,
      fetchedAt: Date.now(),
    })
    emit()
  } finally {
    inFlight.delete(key)
  }
}

export function ensureFolder(provider: Provider, parentId: string | null, force = false) {
  const key = folderCacheKey(provider, parentId)
  const cached = folderCache.get(key)
  const stale = !cached || cached.status === "error" || Date.now() - cached.fetchedAt > STALE_MS
  if (force || stale) void fetchFolder(provider, parentId, key)
}

export function prefetchFolder(provider: Provider, parentId: string | null) {
  const key = folderCacheKey(provider, parentId)
  const cached = folderCache.get(key)
  if (cached && Date.now() - cached.fetchedAt < STALE_MS) return
  if (inFlight.has(key)) return
  void fetchFolder(provider, parentId, key)
}

async function fetchRootFolders(provider: Provider) {
  const key = `${provider}:__rootfolders__`
  if (inFlight.has(key)) return
  const controller = new AbortController()
  inFlight.set(key, controller)
  try {
    const items = await api.listRootFolders(provider, controller.signal)
    rootCache.set(provider, { items, fetchedAt: Date.now() })
    emit()
  } catch {
    // On a transient error keep the previously-loaded areas; don't wipe the sidebar
    // or stamp it fresh, so the next ensureRootFolders retries promptly.
  } finally {
    inFlight.delete(key)
  }
}

export function ensureRootFolders(provider: Provider, force = false) {
  const cached = rootCache.get(provider)
  const stale = !cached || Date.now() - cached.fetchedAt > STALE_MS
  if (force || stale) void fetchRootFolders(provider)
}

async function fetchIntegrations() {
  const key = "__integrations__"
  if (inFlight.has(key)) return
  const controller = new AbortController()
  inFlight.set(key, controller)
  try {
    const value = await api.listIntegrations(controller.signal)
    integrationsState = { value, fetchedAt: Date.now() }
    emit()
  } finally {
    inFlight.delete(key)
  }
}

export function ensureIntegrations(force = false) {
  const stale = integrationsState.fetchedAt === 0 || Date.now() - integrationsState.fetchedAt > 300_000
  if (force || stale) void fetchIntegrations()
}

// ---- React hooks ----
export function useFolder(provider: Provider, parentId: string | null): FolderState {
  const key = folderCacheKey(provider, parentId)
  const state = useSyncExternalStore(
    subscribe,
    () => getFolderSnapshot(key),
    () => EMPTY_FOLDER
  )
  useEffect(() => {
    ensureFolder(provider, parentId)
  }, [provider, parentId])
  return state
}

export function useRootFolders(provider: Provider): DocumentItem[] {
  const items = useSyncExternalStore(
    subscribe,
    () => rootCache.get(provider)?.items ?? EMPTY_ROOT,
    () => EMPTY_ROOT
  )
  useEffect(() => {
    ensureRootFolders(provider)
  }, [provider])
  return items
}

export function useIntegrations(): Integration[] {
  const value = useSyncExternalStore(
    subscribe,
    () => integrationsState.value,
    () => EMPTY_INTEGRATIONS
  )
  useEffect(() => {
    ensureIntegrations()
  }, [])
  return value
}

// ---- debounced recursive search ----
export function useSearch(provider: Provider, term: string, reloadToken = 0) {
  const [state, setState] = useState<{ hits: SearchHit[]; searching: boolean }>({
    hits: [],
    searching: false,
  })
  const seq = useRef(0)

  /* eslint-disable react-hooks/set-state-in-effect -- debounced async search against the server */
  useEffect(() => {
    const trimmed = term.trim()
    if (trimmed.length < 2) {
      setState({ hits: [], searching: false })
      return
    }
    setState((s) => ({ ...s, searching: true }))
    const id = ++seq.current
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api
        .searchItems(provider, trimmed, controller.signal)
        .then((hits) => {
          if (id === seq.current) setState({ hits, searching: false })
        })
        .catch(() => {
          if (id === seq.current) setState({ hits: [], searching: false })
        })
    }, 250)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [provider, term, reloadToken])
  /* eslint-enable react-hooks/set-state-in-effect */

  return state
}

// ---- optimistic cache mutations (each returns a rollback) ----
type Rollback = () => void

export function cacheInsertItem(
  provider: Provider,
  parentId: string | null,
  item: DocumentItem
): Rollback {
  const key = folderCacheKey(provider, parentId)
  const prevFolder = folderCache.get(key)
  if (prevFolder && !prevFolder.items.some((i) => i.id === item.id)) {
    writeFolder(key, { ...prevFolder, items: [...prevFolder.items, item] })
  }
  let prevRoot: { items: DocumentItem[]; fetchedAt: number } | undefined
  if (parentId === null && item.itemType === "folder") {
    prevRoot = rootCache.get(provider)
    if (prevRoot && !prevRoot.items.some((i) => i.id === item.id)) {
      rootCache.set(provider, { items: [...prevRoot.items, item], fetchedAt: prevRoot.fetchedAt })
    }
  }
  emit()
  return () => {
    if (prevFolder) folderCache.set(key, prevFolder)
    if (parentId === null && prevRoot) rootCache.set(provider, prevRoot)
    emit()
  }
}

export function cacheRemoveItem(provider: Provider, parentId: string | null, id: string): Rollback {
  const key = folderCacheKey(provider, parentId)
  const prevFolder = folderCache.get(key)
  if (prevFolder) {
    writeFolder(key, { ...prevFolder, items: prevFolder.items.filter((i) => i.id !== id) })
  }
  const prevRoot = parentId === null ? rootCache.get(provider) : undefined
  if (prevRoot) {
    rootCache.set(provider, { items: prevRoot.items.filter((i) => i.id !== id), fetchedAt: prevRoot.fetchedAt })
  }
  emit()
  return () => {
    if (prevFolder) folderCache.set(key, prevFolder)
    if (prevRoot) rootCache.set(provider, prevRoot)
    emit()
  }
}

export function cacheRenameItem(
  provider: Provider,
  parentId: string | null,
  id: string,
  newName: string
): Rollback {
  const key = folderCacheKey(provider, parentId)
  const prevFolder = folderCache.get(key)
  const patch = (item: DocumentItem): DocumentItem =>
    item.id === id
      ? {
          ...item,
          name: newName,
          extension: item.itemType === "file" ? fileExtension(newName) : item.extension,
          // A folder's path includes its own name; keep it in sync so navigation still works.
          folderPath:
            item.itemType === "folder" && item.folderPath
              ? [...item.folderPath.split("/").slice(0, -1), newName].join("/")
              : item.folderPath,
          lastModifiedAt: new Date().toISOString(),
        }
      : item
  if (prevFolder) {
    writeFolder(key, { ...prevFolder, items: prevFolder.items.map(patch) })
  }
  const prevRoot = parentId === null ? rootCache.get(provider) : undefined
  if (prevRoot) {
    rootCache.set(provider, { items: prevRoot.items.map(patch), fetchedAt: prevRoot.fetchedAt })
  }
  emit()
  return () => {
    if (prevFolder) folderCache.set(key, prevFolder)
    if (prevRoot) rootCache.set(provider, prevRoot)
    emit()
  }
}

export function cacheMoveItem(
  provider: Provider,
  fromParentId: string | null,
  toParentId: string | null,
  item: DocumentItem
): Rollback {
  const fromKey = folderCacheKey(provider, fromParentId)
  const toKey = folderCacheKey(provider, toParentId)
  const prevFrom = folderCache.get(fromKey)
  const prevTo = folderCache.get(toKey)
  if (prevFrom) {
    writeFolder(fromKey, { ...prevFrom, items: prevFrom.items.filter((i) => i.id !== item.id) })
  }
  if (prevTo && !prevTo.items.some((i) => i.id === item.id)) {
    writeFolder(toKey, { ...prevTo, items: [...prevTo.items, item] })
  }
  emit()
  return () => {
    if (prevFrom) folderCache.set(fromKey, prevFrom)
    if (prevTo) folderCache.set(toKey, prevTo)
    emit()
  }
}

/** Force a folder to refetch on next access (e.g. after a complex server-side rename cascade). */
export function invalidateFolder(provider: Provider, parentId: string | null) {
  const key = folderCacheKey(provider, parentId)
  const cur = folderCache.get(key)
  if (cur) writeFolder(key, { ...cur, fetchedAt: 0 })
}

export function invalidateProvider(provider: Provider) {
  for (const key of [...folderCache.keys()]) {
    if (key.startsWith(`${provider}:`)) folderCache.delete(key)
  }
  rootCache.delete(provider)
  emit()
}
