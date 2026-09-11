"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { reportClientError } from "@/lib/errors/client"
import {
  isDomReconcilerMismatch,
  reloadOnceForDomMismatch,
} from "@/lib/errors/dom-mismatch"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [reloading, setReloading] = useState(() => isDomReconcilerMismatch(error))

  useEffect(() => {
    console.error("App route error:", error)
    const domMismatch = isDomReconcilerMismatch(error)
    // Chrome Translate / extension DOM mutations crash the reconciler. A
    // one-shot reload usually recovers; report as warning so it does not
    // look like an unexplained fatal in /sjefen/feil.
    reportClientError({
      message: error.message || "Uventet sidefeil",
      stack: error.stack,
      digest: error.digest,
      level: domMismatch ? "warning" : "error",
      source: "client",
      context: domMismatch ? { action: "dom-reconciler-mismatch" } : undefined,
    })
    if (domMismatch && reloadOnceForDomMismatch()) {
      setReloading(true)
      return
    }
    setReloading(false)
  }, [error])

  if (reloading) return null

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">Noe gikk galt</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          En uventet feil oppstod. Du kan prøve på nytt, eller gå tilbake til forsiden. Hvis
          problemet fortsetter, ta kontakt med support.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-muted-foreground/70">Feilkode: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} className="gap-2">
            <RotateCcw className="size-4" />
            Prøv igjen
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">Gå til forsiden</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
