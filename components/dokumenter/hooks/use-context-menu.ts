"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ContextMenuState, DocumentItem } from "../types"

export function useContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null)
    }
    function onPointer(e: Event) {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return
      setContextMenu(null)
    }
    function onResize() {
      setContextMenu(null)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onPointer)
    window.addEventListener("scroll", onPointer, true)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("mousedown", onPointer)
      window.removeEventListener("scroll", onPointer, true)
      window.removeEventListener("resize", onResize)
    }
  }, [contextMenu])

  const openItem = useCallback((e: React.MouseEvent, item: DocumentItem, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ type: "item", item, index, x: e.clientX, y: e.clientY })
  }, [])

  const openBlank = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ type: "blank", x: e.clientX, y: e.clientY })
  }, [])

  /** Open at an explicit position — used by keyboard (Shift+F10 / ContextMenu key). */
  const openAt = useCallback((x: number, y: number, item: DocumentItem, index: number) => {
    setContextMenu({ type: "item", item, index, x, y })
  }, [])

  const close = useCallback(() => setContextMenu(null), [])

  return { contextMenu, menuRef, openItem, openBlank, openAt, close }
}
