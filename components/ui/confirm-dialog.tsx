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

export type ConfirmOptions = {
  title: string
  description?: React.ReactNode
  /** Tekst på bekreft-knappen. Standard: "Bekreft". */
  confirmText?: string
  /** Tekst på avbryt-knappen. Standard: "Avbryt". */
  cancelText?: string
  /** Bruk "destructive" for sletting o.l. (rød bekreft-knapp). */
  variant?: "default" | "destructive"
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = React.createContext<ConfirmFn | null>(null)

/**
 * Mountes høyt i tre-et (root layout). Gir en stilren bekreftelsesdialog
 * som erstatter window.confirm(). Bruk via useConfirm().
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null)
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null)

  const confirm = React.useCallback<ConfirmFn>((opts) => {
    setOptions(opts)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const resolve = React.useCallback((value: boolean) => {
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
          if (!next) resolve(false)
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
            {options?.description ? (
              <DialogDescription>{options.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => resolve(false)}>
              {options?.cancelText ?? "Avbryt"}
            </Button>
            <Button
              variant={options?.variant === "destructive" ? "destructive" : "default"}
              onClick={() => resolve(true)}
              autoFocus
            >
              {options?.confirmText ?? "Bekreft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

/**
 * Returnerer en async confirm-funksjon. Eksempel:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: "Slette?", variant: "destructive" })) { ... }
 */
export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) {
    throw new Error("useConfirm må brukes innenfor <ConfirmProvider>")
  }
  return ctx
}
