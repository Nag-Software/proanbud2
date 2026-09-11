"use client"

import { useEffect, useState } from "react"

import {
  isDomReconcilerMismatch,
  reloadOnceForDomMismatch,
} from "@/lib/errors/dom-mismatch"

// global-error replaces the root layout, so it must render its own <html>/<body>
// and cannot rely on app providers, fonts, or CSS — use inline styles only.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [reloading, setReloading] = useState(() => isDomReconcilerMismatch(error))

  useEffect(() => {
    console.error("Global app error:", error)
    const domMismatch = isDomReconcilerMismatch(error)
    // Self-contained report so even root crashes show up in /sjefen/feil.
    // DOM reconciler mismatches are recovered with a one-shot reload — do not
    // mark those fatal (they white-screened /tilbud and / for a new company).
    try {
      void fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error?.message || "Fatal applikasjonsfeil",
          stack: error?.stack ?? null,
          digest: error?.digest ?? null,
          level: domMismatch ? "warning" : "fatal",
          source: "client",
          route: typeof window !== "undefined" ? window.location?.pathname : null,
          context: domMismatch ? { action: "dom-reconciler-mismatch" } : undefined,
        }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* never throw from an error boundary */
    }
    if (domMismatch && reloadOnceForDomMismatch()) {
      setReloading(true)
    } else {
      setReloading(false)
    }
  }, [error])

  if (reloading) {
    return (
      <html lang="no" translate="no" className="notranslate">
        <body />
      </html>
    )
  }

  return (
    <html lang="no" translate="no" className="notranslate">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
          background: "#f5f5f4",
          color: "#1c1917",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e7e5e4",
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          }}
        >
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Noe gikk galt</h1>
          <p style={{ marginTop: 8, fontSize: 14, color: "#78716c", lineHeight: 1.5 }}>
            En uventet feil oppstod i applikasjonen. Prøv å laste siden på nytt.
          </p>
          {error.digest ? (
            <p style={{ marginTop: 12, fontSize: 11, fontFamily: "monospace", color: "#a8a29e" }}>
              Feilkode: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              cursor: "pointer",
              borderRadius: 8,
              border: "none",
              background: "#1c1917",
              color: "#ffffff",
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            Prøv igjen
          </button>
        </div>
      </body>
    </html>
  )
}
