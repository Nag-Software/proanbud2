import "server-only"
import { createHash } from "crypto"

import { createAdminClient } from "@/lib/supabase/admin"

export type ErrorLevel = "warning" | "error" | "fatal"
export type ErrorSource = "client" | "server" | "api" | "action" | "worker"

export type LogErrorInput = {
  message: string
  level?: ErrorLevel
  source?: ErrorSource
  /** An Error, or anything thrown — stack/message are extracted automatically. */
  error?: unknown
  stack?: string | null
  digest?: string | null
  route?: string | null
  method?: string | null
  statusCode?: number | null
  companyId?: string | null
  userId?: string | null
  userEmail?: string | null
  userAgent?: string | null
  context?: Record<string, unknown>
}

function normalizeForFingerprint(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d[\d.,]*\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300)
}

/** Stable signature used to group recurring occurrences of the same error. */
export function errorFingerprint(parts: {
  source: string
  level: string
  route?: string | null
  message: string
}): string {
  const base = `${parts.source}|${parts.level}|${parts.route ?? ""}|${normalizeForFingerprint(parts.message)}`
  return createHash("sha1").update(base).digest("hex").slice(0, 16)
}

function extractMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message || fallback
  if (typeof error === "string") return error || fallback
  if (error && typeof error === "object") {
    const m = (error as { message?: unknown }).message
    if (typeof m === "string" && m) return m
  }
  return fallback
}

function extractStack(error: unknown): string | null {
  if (error instanceof Error && error.stack) return error.stack
  return null
}

/**
 * Records an error to the central log. NEVER throws — a logging failure must not
 * break the flow that called it. Safe to `await` or fire-and-forget.
 */
export async function logServerError(input: LogErrorInput): Promise<void> {
  try {
    const level = input.level ?? "error"
    const source = input.source ?? "server"
    const message = (input.message || extractMessage(input.error, "Ukjent feil")).slice(0, 2000)
    const stack = (input.stack ?? extractStack(input.error))?.slice(0, 8000) ?? null

    const admin = createAdminClient()
    await admin.from("error_logs").insert({
      level,
      source,
      message,
      stack,
      digest: input.digest ?? null,
      route: input.route ?? null,
      method: input.method ?? null,
      status_code: input.statusCode ?? null,
      company_id: input.companyId ?? null,
      user_id: input.userId ?? null,
      user_email: input.userEmail ?? null,
      user_agent: input.userAgent ?? null,
      context: input.context ?? {},
      fingerprint: errorFingerprint({ source, level, route: input.route, message }),
    })
  } catch (err) {
    // Last-resort: never propagate logging failures.
    console.error("[logServerError] failed to record error:", err)
  }
}
