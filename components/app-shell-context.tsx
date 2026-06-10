"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type AppShellPageMeta = {
  segments: string[]
  noPadding: boolean
}

type AppShellContextValue = {
  insideShell: boolean
  pageMeta: AppShellPageMeta
  setPageMeta: (meta: AppShellPageMeta) => void
}

const defaultPageMeta: AppShellPageMeta = {
  segments: [],
  noPadding: false,
}

function pageMetaEquals(a: AppShellPageMeta, b: AppShellPageMeta) {
  if (a.noPadding !== b.noPadding) return false
  if (a.segments.length !== b.segments.length) return false
  return a.segments.every((segment, index) => segment === b.segments[index])
}

const AppShellContext = createContext<AppShellContextValue | null>(null)

export function AppShellProvider({
  children,
  enabled,
}: {
  children: ReactNode
  enabled: boolean
}) {
  const [pageMeta, setPageMetaState] = useState<AppShellPageMeta>(defaultPageMeta)

  const setPageMeta = useCallback((meta: AppShellPageMeta) => {
    setPageMetaState((prev) => (pageMetaEquals(prev, meta) ? prev : meta))
  }, [])

  const value = useMemo(
    () => ({
      insideShell: enabled,
      pageMeta,
      setPageMeta,
    }),
    [enabled, pageMeta, setPageMeta]
  )

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
}

export function useAppShell() {
  return useContext(AppShellContext)
}
