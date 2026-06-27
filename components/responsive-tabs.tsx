"use client"

import * as React from "react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export type ResponsiveTabItem = {
  value: string
  label: string
  shortLabel?: string
  hidden?: boolean
}

type ResponsiveTabsProps = {
  tabs: ResponsiveTabItem[]
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  className?: string
  children: React.ReactNode
}

export function ResponsiveTabs({
  tabs,
  defaultValue,
  value: controlledValue,
  onValueChange,
  className,
  children,
}: ResponsiveTabsProps) {
  const isMobile = useIsMobile()
  const visibleTabs = tabs.filter((tab) => !tab.hidden)
  const [uncontrolledValue, setUncontrolledValue] = React.useState(
    defaultValue ?? visibleTabs[0]?.value ?? ""
  )

  const value = controlledValue ?? uncontrolledValue

  const handleValueChange = (next: string) => {
    if (controlledValue === undefined) {
      setUncontrolledValue(next)
    }
    onValueChange?.(next)
  }

  return (
    <Tabs value={value} onValueChange={handleValueChange} className={cn("w-full", className)}>
      <div className="-mx-4 mb-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabsList className="inline-flex h-auto w-max">
          {visibleTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="shrink-0 flex-none px-3 sm:px-4"
            >
              {isMobile ? (tab.shortLabel ?? tab.label) : tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {children}
    </Tabs>
  )
}

export { TabsContent }
