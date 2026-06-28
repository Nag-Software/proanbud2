"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import type { DocumentItem } from "../types"

type ClickModifiers = { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }

/**
 * Finder/Explorer-style selection over the current (sorted) item list.
 * Selection is tracked by id so it survives re-sorts; it clears on folder change.
 */
export function useSelection(items: DocumentItem[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const anchorRef = useRef(-1)

  // No explicit reset needed on folder change: selectedItems/count derive from the
  // current `items`, so stale ids from a previous folder simply fall out, and the
  // views clamp `focusedIndex` into range. This keeps the hook effect-free.

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    anchorRef.current = -1
  }, [])

  const selectOnly = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) return
      setSelectedIds(new Set([item.id]))
      setFocusedIndex(index)
      anchorRef.current = index
    },
    [items]
  )

  const toggle = useCallback(
    (index: number) => {
      const item = items[index]
      if (!item) return
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      setFocusedIndex(index)
      anchorRef.current = index
    },
    [items]
  )

  const selectRange = useCallback(
    (toIndex: number) => {
      const from = anchorRef.current < 0 ? toIndex : anchorRef.current
      const [a, b] = from <= toIndex ? [from, toIndex] : [toIndex, from]
      const next = new Set<string>()
      for (let i = a; i <= b; i++) {
        const it = items[i]
        if (it) next.add(it.id)
      }
      setSelectedIds(next)
      setFocusedIndex(toIndex)
    },
    [items]
  )

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((i) => i.id)))
  }, [items])

  const selectById = useCallback(
    (id: string) => {
      const index = items.findIndex((i) => i.id === id)
      if (index >= 0) selectOnly(index)
    },
    [items, selectOnly]
  )

  const handleItemClick = useCallback(
    (index: number, e: ClickModifiers) => {
      if (e.shiftKey) selectRange(index)
      else if (e.metaKey || e.ctrlKey) toggle(index)
      else selectOnly(index)
    },
    [selectRange, toggle, selectOnly]
  )

  // Derived from current items so stale ids (after delete/move) never inflate counts.
  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds]
  )
  const count = selectedItems.length
  const allSelected = items.length > 0 && count === items.length
  const someSelected = count > 0 && !allSelected

  return {
    selectedIds,
    selectedItems,
    count,
    allSelected,
    someSelected,
    focusedIndex,
    setFocusedIndex,
    isSelected,
    clear,
    selectOnly,
    selectById,
    toggle,
    selectRange,
    selectAll,
    handleItemClick,
  }
}

export type SelectionApi = ReturnType<typeof useSelection>
