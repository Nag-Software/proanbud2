"use client"

import { useCallback, useState } from "react"
import type { DocumentItem, Provider } from "../types"

type Args = {
  provider: Provider
  onMove: (item: DocumentItem, targetFolderPath: string | null) => void | Promise<void>
  onNativeDrop: (files: FileList) => void
}

/** Drag-to-move (Supabase files only) + native-file-drop upload detection. */
export function useDragMove({ provider, onMove, onNativeDrop }: Args) {
  const [draggingItem, setDraggingItem] = useState<DocumentItem | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null | undefined>(undefined)
  const [isDraggingNative, setIsDraggingNative] = useState(false)

  const canDrag = useCallback(
    (item: DocumentItem) => provider === "supabase" && item.itemType === "file",
    [provider]
  )

  const onRowDragStart = useCallback(
    (item: DocumentItem) => {
      if (!canDrag(item)) return
      setDraggingItem(item)
    },
    [canDrag]
  )

  const onRowDragEnd = useCallback(() => {
    setDraggingItem(null)
    setDropTargetPath(undefined)
  }, [])

  const onDragOverFolder = useCallback(
    (e: React.DragEvent, targetFolderPath: string | null) => {
      if (!draggingItem || !canDrag(draggingItem)) return
      e.preventDefault()
      setDropTargetPath(targetFolderPath)
    },
    [draggingItem, canDrag]
  )

  const onDropToFolder = useCallback(
    async (e: React.DragEvent, targetFolderPath: string | null) => {
      e.preventDefault()
      if (!draggingItem) return
      const moved = draggingItem
      setDropTargetPath(undefined)
      setDraggingItem(null)
      await onMove(moved, targetFolderPath)
    },
    [draggingItem, onMove]
  )

  const onSectionDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!draggingItem) setIsDraggingNative(true)
    },
    [draggingItem]
  )

  const onSectionDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingNative(false)
  }, [])

  const onSectionDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDraggingNative(false)
      if (!draggingItem && e.dataTransfer.files?.length > 0) {
        onNativeDrop(e.dataTransfer.files)
      }
    },
    [draggingItem, onNativeDrop]
  )

  return {
    draggingItem,
    dropTargetPath,
    isDraggingNative,
    onRowDragStart,
    onRowDragEnd,
    onDragOverFolder,
    onDropToFolder,
    onSectionDragOver,
    onSectionDragLeave,
    onSectionDrop,
  }
}

export type DragMoveApi = ReturnType<typeof useDragMove>
