"use client"

import { useCallback, useRef } from "react"
import type { DocumentItem } from "../types"
import type { SelectionApi } from "./use-selection"

type Args = {
  items: DocumentItem[]
  selection: SelectionApi
  /** Columns in the current layout: 1 for the list, measured for the grid. */
  getColumns: () => number
  onOpen: (item: DocumentItem, index: number) => void
  onPreview: (item: DocumentItem) => void
  onRename: (item: DocumentItem) => void
  onDeleteItems: (items: DocumentItem[]) => void
  onContextMenuAt: (item: DocumentItem, index: number, x: number, y: number) => void
}

/** Finder/Explorer-style roving-tabindex keyboard model shared by list + grid. */
export function useFileKeyboard({
  items,
  selection,
  getColumns,
  onOpen,
  onPreview,
  onRename,
  onDeleteItems,
  onContextMenuAt,
}: Args) {
  const rowsRef = useRef<(HTMLElement | null)[]>([])
  const typeahead = useRef<{ buffer: string; at: number }>({ buffer: "", at: 0 })

  const setRowRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      rowsRef.current[index] = el
    },
    []
  )

  const focusDom = useCallback((index: number) => {
    const el = rowsRef.current[index]
    if (el) {
      el.focus()
      el.scrollIntoView({ block: "nearest" })
    }
  }, [])

  const moveTo = useCallback(
    (target: number, extend: boolean) => {
      if (items.length === 0) return
      const clamped = Math.max(0, Math.min(items.length - 1, target))
      if (extend) selection.selectRange(clamped)
      else selection.selectOnly(clamped)
      focusDom(clamped)
    },
    [items.length, selection, focusDom]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (items.length === 0) return
      const cols = Math.max(1, getColumns())
      const cur = selection.focusedIndex < 0 ? 0 : selection.focusedIndex
      const focused = items[cur]

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          moveTo(cur + cols, e.shiftKey)
          return
        case "ArrowUp":
          e.preventDefault()
          moveTo(cur - cols, e.shiftKey)
          return
        case "ArrowRight":
          if (cols > 1) {
            e.preventDefault()
            moveTo(cur + 1, e.shiftKey)
          }
          return
        case "ArrowLeft":
          if (cols > 1) {
            e.preventDefault()
            moveTo(cur - 1, e.shiftKey)
          }
          return
        case "Home":
          e.preventDefault()
          moveTo(0, e.shiftKey)
          return
        case "End":
          e.preventDefault()
          moveTo(items.length - 1, e.shiftKey)
          return
        case "Enter":
          e.preventDefault()
          if (focused) onOpen(focused, cur)
          return
        case " ":
          e.preventDefault()
          if (focused && focused.itemType === "file") onPreview(focused)
          else if (focused) onOpen(focused, cur)
          return
        case "Delete":
        case "Backspace": {
          e.preventDefault()
          const targets = selection.selectedItems.length > 0 ? selection.selectedItems : focused ? [focused] : []
          if (targets.length) onDeleteItems(targets)
          return
        }
        case "F2":
          e.preventDefault()
          if (focused) onRename(focused)
          return
        case "a":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault()
            selection.selectAll()
          }
          return
        case "Escape":
          selection.clear()
          return
        case "F10":
          if (e.shiftKey && focused) {
            e.preventDefault()
            const rect = rowsRef.current[cur]?.getBoundingClientRect()
            onContextMenuAt(focused, cur, rect ? rect.left + 8 : 200, rect ? rect.bottom : 200)
          }
          return
        case "ContextMenu":
          if (focused) {
            e.preventDefault()
            const rect = rowsRef.current[cur]?.getBoundingClientRect()
            onContextMenuAt(focused, cur, rect ? rect.left + 8 : 200, rect ? rect.bottom : 200)
          }
          return
        default:
          // type-ahead jump
          if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
            const now = Date.now()
            const buffer = now - typeahead.current.at > 600 ? e.key : typeahead.current.buffer + e.key
            typeahead.current = { buffer, at: now }
            const lower = buffer.toLowerCase()
            const start = buffer.length === 1 ? cur + 1 : cur
            for (let off = 0; off < items.length; off++) {
              const idx = (start + off) % items.length
              if (items[idx].name.toLowerCase().startsWith(lower)) {
                moveTo(idx, false)
                break
              }
            }
          }
      }
    },
    [items, getColumns, selection, moveTo, onOpen, onPreview, onRename, onDeleteItems, onContextMenuAt]
  )

  return { onKeyDown, setRowRef }
}
