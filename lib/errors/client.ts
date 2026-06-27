"use client"

export type ClientErrorReport = {
  message: string
  stack?: string | null
  digest?: string | null
  route?: string | null
  level?: "warning" | "error" | "fatal"
  source?: "client" | "server" | "api" | "action" | "worker"
  context?: Record<string, unknown>
}

/**
 * Best-effort client → server error report. Never throws and never blocks the UI:
 * call it alongside a user-facing toast when something fails. The report shows up in
 * /sjefen/feil. `keepalive` lets it survive an immediate navigation/unmount.
 */
export function reportClientError(input: ClientErrorReport | unknown, extra?: Partial<ClientErrorReport>): void {
  try {
    let report: ClientErrorReport
    if (input && typeof input === "object" && "message" in input && typeof (input as ClientErrorReport).message === "string") {
      report = input as ClientErrorReport
    } else if (input instanceof Error) {
      report = { message: input.message, stack: input.stack ?? null }
    } else {
      report = { message: typeof input === "string" ? input : "Ukjent klientfeil" }
    }

    const payload: ClientErrorReport = {
      level: "error",
      source: "client",
      route: typeof window !== "undefined" ? window.location?.pathname : undefined,
      ...report,
      ...extra,
      context: { ...(report.context ?? {}), ...(extra?.context ?? {}) },
    }

    void fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* swallow — reporting must never surface its own error */
    })
  } catch {
    /* never throw */
  }
}
