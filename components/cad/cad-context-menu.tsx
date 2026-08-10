"use client"

/**
 * Høyreklikk-meny for tegneflaten.
 *
 * Egen liten meny i stedet for Radix' ContextMenu: den skal åpne på et
 * vilkårlig punkt i et SVG-lerret (ikke rundt et DOM-element), og den må kunne
 * åpnes både fra planen og fra 3D-scenen med samme innhold. Stylingen følger
 * dropdown-menyene ellers i appen.
 */

import * as React from "react"

import { cn } from "@/lib/utils"

export type CadMenuItem = {
  label: string
  onSelect: () => void
  icon?: React.ComponentType<{ className?: string }>
  /** Rød tekst for slett o.l. */
  destructive?: boolean
  disabled?: boolean
  /** Skillelinje over dette punktet. */
  separatorBefore?: boolean
  /** Kort forklaring under etiketten. */
  hint?: string
}

export function CadContextMenu({
  x,
  y,
  title,
  items,
  onClose,
}: {
  x: number
  y: number
  title?: string
  items: CadMenuItem[]
  onClose: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [position, setPosition] = React.useState({ left: x, top: y })

  // Hold menyen innenfor tegneflaten — høyreklikk nede til høyre skal ikke
  // sende halve menyen utenfor kanten.
  React.useLayoutEffect(() => {
    const element = ref.current
    const parent = element?.offsetParent as HTMLElement | null
    if (!element || !parent) return
    const menu = element.getBoundingClientRect()
    const bounds = parent.getBoundingClientRect()
    setPosition({
      left: Math.min(x, Math.max(bounds.width - menu.width - 8, 8)),
      top: Math.min(y, Math.max(bounds.height - menu.height - 8, 8)),
    })
  }, [x, y])

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    // `capture` slik at vi lukker før tegneflaten rekker å tolke klikket.
    window.addEventListener("pointerdown", onPointerDown, true)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className="absolute z-50 min-w-52 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      onContextMenu={(event) => event.preventDefault()}
    >
      {title && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{title}</div>
      )}
      {items.map((item, index) => (
        <React.Fragment key={`${item.label}-${index}`}>
          {item.separatorBefore && <div className="my-1 h-px bg-border" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect()
              onClose()
            }}
            className={cn(
              "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
              item.disabled
                ? "pointer-events-none opacity-50"
                : "hover:bg-accent hover:text-accent-foreground",
              item.destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive"
            )}
          >
            {item.icon && <item.icon className="mt-0.5 size-4 shrink-0" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{item.label}</span>
              {item.hint && (
                <span className="block truncate text-[11px] text-muted-foreground">{item.hint}</span>
              )}
            </span>
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}
