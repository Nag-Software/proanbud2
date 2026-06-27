"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type ConfirmOptions = {
  title?: string
  description?: React.ReactNode
  /** Tekst på bekreft-knappen. Default "Bekreft". */
  confirmText?: string
  /** Tekst på avbryt-knappen. Default "Avbryt". */
  cancelText?: string
  /** Bruk "destructive" for sletting o.l. Default "default". */
  variant?: "default" | "destructive"
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

/**
 * Returnerer en async `confirm(options)`-funksjon som åpner en bekreftelsesdialog
 * og resolver til true (bekreftet) eller false (avbrutt). Erstatter window.confirm.
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: "Slette kunde?", variant: "destructive" })) { ... }
 */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) {
    throw new Error("useConfirm må brukes innenfor en <ConfirmProvider>")
  }
  return ctx
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<ConfirmOptions>({})
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null)

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    setOptions(opts)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = React.useCallback((value: boolean) => {
    setOpen(false)
    resolverRef.current?.(value)
    resolverRef.current = null
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) settle(false)
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{options.title ?? "Er du sikker?"}</DialogTitle>
            {options.description ? (
              <DialogDescription>{options.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {options.cancelText ?? "Avbryt"}
            </Button>
            <Button
              variant={options.variant === "destructive" ? "destructive" : "default"}
              onClick={() => settle(true)}
              autoFocus
            >
              {options.confirmText ?? "Bekreft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}
