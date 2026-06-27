"use client"

import { useEffect } from "react"

// global-error replaces the root layout, so it must render its own <html>/<body>
// and cannot rely on app providers, fonts, or CSS — use inline styles only.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Global app error:", error)
    // Self-contained report (global-error must not depend on app modules). Records to
    // the central error log so even fatal root crashes show up in /sjefen/feil.
    try {
      void fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: error?.message || "Fatal applikasjonsfeil",
          stack: error?.stack ?? null,
          digest: error?.digest ?? null,
          level: "fatal",
          source: "client",
          route: typeof window !== "undefined" ? window.location?.pathname : null,
        }),
        keepalive: true,
      }).catch(() => {})
    } catch {
      /* never throw from an error boundary */
    }
  }, [error])

  return (
    <html lang="no">
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
