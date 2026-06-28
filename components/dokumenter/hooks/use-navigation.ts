"use client"

import { useCallback, useMemo, useState } from "react"
import { folderPathFromItem } from "../utils"
import type { DocumentItem, PathNode, Provider } from "../types"

const ROOT_LABELS: Record<Provider, string> = {
  supabase: "Alle områder",
  google_drive: "Google Drive",
  onedrive: "OneDrive",
}

function rootNode(provider: Provider): PathNode {
  return { id: null, name: ROOT_LABELS[provider] }
}

export function useNavigation(provider: Provider) {
  const [pathStacks, setPathStacks] = useState<Record<Provider, PathNode[]>>({
    supabase: [rootNode("supabase")],
    google_drive: [rootNode("google_drive")],
    onedrive: [rootNode("onedrive")],
  })

  const currentPath = useMemo(
    () => pathStacks[provider] ?? [rootNode(provider)],
    [pathStacks, provider]
  )
  const currentFolderId = currentPath[currentPath.length - 1]?.id ?? null

  const navTargetId = useCallback(
    (item: DocumentItem) =>
      item.provider === "supabase" ? folderPathFromItem(item) ?? item.id : item.id,
    []
  )

  const openFolder = useCallback(
    (item: DocumentItem) => {
      const nextId = navTargetId(item)
      setPathStacks((prev) => ({
        ...prev,
        [provider]: [...(prev[provider] ?? [rootNode(provider)]), { id: nextId, name: item.name }],
      }))
    },
    [provider, navTargetId]
  )

  const selectArea = useCallback(
    (item: DocumentItem) => {
      const nextId = navTargetId(item)
      setPathStacks((prev) => ({
        ...prev,
        [provider]: [rootNode(provider), { id: nextId, name: item.name }],
      }))
    },
    [provider, navTargetId]
  )

  const goHome = useCallback(() => {
    setPathStacks((prev) => ({ ...prev, [provider]: [rootNode(provider)] }))
  }, [provider])

  const goBack = useCallback(() => {
    setPathStacks((prev) => {
      const stack = prev[provider] ?? [rootNode(provider)]
      if (stack.length <= 1) return prev
      return { ...prev, [provider]: stack.slice(0, -1) }
    })
  }, [provider])

  const jumpToPathIndex = useCallback(
    (index: number) => {
      setPathStacks((prev) => ({
        ...prev,
        [provider]: (prev[provider] ?? [rootNode(provider)]).slice(0, index + 1),
      }))
    },
    [provider]
  )

  /** Navigate directly to an absolute Supabase folder path (used by search results). */
  const navigateToPath = useCallback(
    (path: string) => {
      const segments = path.split("/").filter(Boolean)
      const nodes: PathNode[] = [rootNode(provider)]
      let acc = ""
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg
        nodes.push({ id: acc, name: seg })
      }
      setPathStacks((prev) => ({ ...prev, [provider]: nodes }))
    },
    [provider]
  )

  return useMemo(
    () => ({
      currentPath,
      currentFolderId,
      openFolder,
      selectArea,
      goHome,
      goBack,
      jumpToPathIndex,
      navigateToPath,
    }),
    [currentPath, currentFolderId, openFolder, selectArea, goHome, goBack, jumpToPathIndex, navigateToPath]
  )
}
