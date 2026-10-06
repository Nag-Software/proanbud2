import { createHash, randomUUID } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"

// Gratiskvoten for den offentlige tilbudskalkulatoren (db/111).
//
// Hvert tilbud koster KI-tokens + nettprissøk, så kvoten håndheves på
// serveren, på to nøkler samtidig:
//   * nettleser (httpOnly-cookie med tilfeldig ID) — teller for alltid
//   * nettverk (hashet IP) — teller i et rullerende vindu, så inkognito /
//     tømte cookies ikke gir ny kvote
// pluss et globalt dagstak som ren kostnadsbrems.

export const KALKULATOR_LIMIT = Math.max(1, Number(process.env.KALKULATOR_FREE_LIMIT) || 3)
const IP_WINDOW_DAYS = Math.max(1, Number(process.env.KALKULATOR_IP_WINDOW_DAYS) || 30)
const GLOBAL_DAILY_LIMIT = Math.max(1, Number(process.env.KALKULATOR_GLOBAL_DAILY_LIMIT) || 150)

export const KALKULATOR_COOKIE = "pa_kalk"
export const KALKULATOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export type KalkulatorVisitor = {
  visitorId: string
  /** Telleren i cookien — kun reserve hvis databasen ikke svarer. */
  cookieCount: number
  ipHash: string | null
}

export type KalkulatorClaim =
  | { allowed: true; usageId: string | null; used: number }
  | { allowed: false; reason: "limit" | "global"; used: number }

/** Cookie-format: `v2.<visitorId>.<antall>`. Eldre `dato:antall` ignoreres. */
export function readVisitor(cookieValue: string | undefined, headers: Headers): KalkulatorVisitor {
  const [version, id, count] = (cookieValue ?? "").split(".")
  const valid = version === "v2" && /^[0-9a-f-]{36}$/.test(id ?? "")
  return {
    visitorId: valid ? id : randomUUID(),
    cookieCount: valid ? Math.max(0, Number(count) || 0) : 0,
    ipHash: hashIp(headers),
  }
}

export function visitorCookieValue(visitor: KalkulatorVisitor, used: number): string {
  return `v2.${visitor.visitorId}.${used}`
}

function hashIp(headers: Headers): string | null {
  // Vercel setter x-forwarded-for; første ledd er den faktiske klienten.
  const raw = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  if (!raw) return null
  // IPv6: en husstand får et helt /64 — hash prefikset, ellers er grensa
  // omgått med et adressebytte.
  const ip = raw.includes(":") ? raw.split(":").slice(0, 4).join(":") : raw
  const salt = process.env.KALKULATOR_IP_SALT || "proanbud-kalkulator"
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex")
}

/** Hvor mange gratis tilbud den besøkende har brukt (uten å bokføre noe). */
export async function getKalkulatorUsed(visitor: KalkulatorVisitor): Promise<number> {
  try {
    const admin = createAdminClient()
    const since = new Date(Date.now() - IP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const [byVisitor, byIp] = await Promise.all([
      admin
        .from("kalkulator_usage")
        .select("id", { count: "exact", head: true })
        .eq("visitor_id", visitor.visitorId),
      visitor.ipHash
        ? admin
            .from("kalkulator_usage")
            .select("id", { count: "exact", head: true })
            .eq("ip_hash", visitor.ipHash)
            .gt("created_at", since)
        : Promise.resolve({ count: 0, error: null }),
    ])
    if (byVisitor.error || byIp.error) throw byVisitor.error || byIp.error
    return Math.max(byVisitor.count ?? 0, byIp.count ?? 0, visitor.cookieCount)
  } catch (error) {
    console.warn("[kalkulator] kvoteoppslag feilet — bruker cookie-telleren", error)
    return visitor.cookieCount
  }
}

/**
 * Sjekker kvoten og bokfører ett tilbud atomisk. Kalles FØR nettsøk/KI-kall.
 * Svarer ikke databasen, faller vi tilbake på cookie-telleren i stedet for å
 * ta ned kalkulatoren.
 */
export async function claimKalkulatorUse(visitor: KalkulatorVisitor): Promise<KalkulatorClaim> {
  if (visitor.cookieCount >= KALKULATOR_LIMIT) {
    return { allowed: false, reason: "limit", used: visitor.cookieCount }
  }
  try {
    const { data, error } = await createAdminClient().rpc("claim_kalkulator_use", {
      p_visitor_id: visitor.visitorId,
      p_ip_hash: visitor.ipHash,
      p_limit: KALKULATOR_LIMIT,
      p_ip_window_days: IP_WINDOW_DAYS,
      p_global_daily_limit: GLOBAL_DAILY_LIMIT,
    })
    if (error) throw error
    const result = data as { allowed: boolean; reason?: "limit" | "global"; id?: string; used: number }
    if (!result.allowed) {
      return { allowed: false, reason: result.reason ?? "limit", used: result.used }
    }
    return { allowed: true, usageId: result.id ?? null, used: result.used }
  } catch (error) {
    console.warn("[kalkulator] kvotebokføring feilet — bruker cookie-telleren", error)
    return { allowed: true, usageId: null, used: visitor.cookieCount + 1 }
  }
}

/** Gir tilbake et bokført forsøk når genereringen feilet — brukeren fikk ingenting. */
export async function refundKalkulatorUse(usageId: string | null): Promise<void> {
  if (!usageId) return
  try {
    await createAdminClient().from("kalkulator_usage").delete().eq("id", usageId)
  } catch (error) {
    console.warn("[kalkulator] kunne ikke tilbakeføre kvote", error)
  }
}
