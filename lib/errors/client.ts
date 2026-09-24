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

// Samme grenser som zod-skjemaet i app/api/errors/route.ts — overskrides de,
// avviser serveren hele rapporten med 400.
const MAX_MESSAGE_LENGTH = 2000
const MAX_STACK_LENGTH = 8000

/** Bygger payloaden til /api/errors. Eksportert for test. */
export function buildClientErrorPayload(
  input: ClientErrorReport | unknown,
  extra?: Partial<ClientErrorReport>,
  route?: string
): ClientErrorReport {
  let report: ClientErrorReport
  // Error må sjekkes først: message/stack er ikke-enumerable på Error, så en
  // spread (`...report`) under ville droppet dem og /api/errors svart 400.
  if (input instanceof Error) {
    report = { message: input.message, stack: input.stack ?? null }
  } else if (input && typeof input === "object" && "message" in input && typeof (input as ClientErrorReport).message === "string") {
    report = input as ClientErrorReport
  } else {
    report = { message: typeof input === "string" ? input : "" }
  }

  const merged: ClientErrorReport = {
    level: "error",
    source: "client",
    route,
    ...report,
    ...extra,
    context: { ...(report.context ?? {}), ...(extra?.context ?? {}) },
  }

  const message = merged.message?.trim() || (input instanceof Error ? input.name : "") || "Ukjent klientfeil"
  return {
    ...merged,
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    stack: merged.stack ? merged.stack.slice(0, MAX_STACK_LENGTH) : merged.stack,
  }
}

/**
 * Best-effort client → server error report. Never throws and never blocks the UI:
 * call it alongside a user-facing toast when something fails. The report shows up in
 * /sjefen/feil. `keepalive` lets it survive an immediate navigation/unmount.
 */
export function reportClientError(input: ClientErrorReport | unknown, extra?: Partial<ClientErrorReport>): void {
  try {
    const payload = buildClientErrorPayload(
      input,
      extra,
      typeof window !== "undefined" ? window.location?.pathname : undefined
    )

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

/**
 * Tekst til brukeren fra en feil. Feil kastet i en server action har i produksjon
 * en generisk engelsk melding fra Next.js («An error occurred in the Server
 * Components render…», med `digest`) – da vises den norske reserveteksten i stedet.
 */
export function actionErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback
  const isRedactedServerError =
    "digest" in error ||
    /omitted in production|Server Components render|An unexpected response was received/i.test(error.message)
  return isRedactedServerError ? fallback : error.message
}
