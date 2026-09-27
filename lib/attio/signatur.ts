// Signaturen på webhooks fra Attio: SHA-256-HMAC av råteksten med webhookens
// hemmelighet, hex-kodet, i headeren Attio-Signature. Uten gyldig signatur
// rører vi ingenting — ellers kunne hvem som helst flyttet deals i Proanbud.

import { createHmac, timingSafeEqual } from "node:crypto"

export function signAttioBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
}

/** Konstant tid, og aldri en exception på rart input. */
export function verifyAttioSignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false
  const expected = Buffer.from(signAttioBody(rawBody, secret), "hex")
  const given = Buffer.from(signature.trim().toLowerCase(), "hex")
  if (given.length !== expected.length || given.length === 0) return false
  return timingSafeEqual(given, expected)
}
