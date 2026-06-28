"use client"

import { ChevronLeft, ChevronRight, MoreHorizontal, PanelLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { PathNode } from "../types"

type Props = {
  currentPath: PathNode[]
  onBack: () => void
  onJump: (index: number) => void
  onOpenAreas: () => void
}

export function DocumentsBreadcrumb({ currentPath, onBack, onJump, onOpenAreas }: Props) {
  const canBack = currentPath.length > 1

  // Collapse the middle when the path is deep: first … last two.
  const collapsed = currentPath.length > 4
  const visible = collapsed
    ? [
        { node: currentPath[0], index: 0 },
        ...currentPath.slice(-2).map((node, i) => ({ node, index: currentPath.length - 2 + i })),
      ]
    : currentPath.map((node, index) => ({ node, index }))
  const hidden = collapsed ? currentPath.slice(1, -2).map((node, i) => ({ node, index: i + 1 })) : []

  return (
    <nav
      aria-label="Plassering"
      className="theme-doc-breadcrumbs flex items-center gap-1 border-b px-3 py-2"
    >
      <Button variant="outline" size="sm" className="h-7 gap-1.5 lg:hidden" onClick={onOpenAreas}>
        <PanelLeft className="h-4 w-4" />
        Områder
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        disabled={!canBack}
        onClick={onBack}
        aria-label="Gå tilbake"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <ol className="flex min-w-0 flex-1 items-center">
        {visible.map(({ node, index }, i) => {
          const isLast = index === currentPath.length - 1
          return (
            <li key={`${node.name}-${index}`} className="flex min-w-0 items-center">
              {i > 0 && <ChevronRight className="theme-icon-muted h-4 w-4 shrink-0" />}
              {collapsed && i === 1 && hidden.length > 0 && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Vis skjulte mapper">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {hidden.map(({ node: h, index: hi }) => (
                        <DropdownMenuItem key={`${h.name}-${hi}`} onClick={() => onJump(hi)}>
                          {h.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <ChevronRight className="theme-icon-muted h-4 w-4 shrink-0" />
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="theme-doc-breadcrumb h-7 max-w-[16ch] truncate px-2"
                aria-current={isLast ? "page" : undefined}
                onClick={() => onJump(index)}
              >
                <span className="truncate">{node.name}</span>
              </Button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
