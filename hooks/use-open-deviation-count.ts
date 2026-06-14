"use client"

import * as React from "react"

import { getOpenDeviationCountAction } from "@/app/avvik/actions"

export function useOpenDeviationCount() {
  const [count, setCount] = React.useState(0)

  React.useEffect(() => {
    async function load() {
      try {
        const openCount = await getOpenDeviationCountAction()
        setCount(openCount)
      } catch {
        setCount(0)
      }
    }
    void load()
  }, [])

  return count
}
