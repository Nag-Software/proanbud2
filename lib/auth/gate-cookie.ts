/**
 * Signert hurtigvei-cookie for middleware-porten.
 *
 * Porten i `updateSession` kan hoppe over onboarding-/abonnements-RPC-ene når
 * den nylig har verifisert brukeren. Tidligere var cookie-verdien bare
 * `user.id` — en verdi brukeren selv kjenner fra sitt eget JWT (`sub`).
 * `httpOnly` hindrer JavaScript i å LESE cookien, men hindrer ingen i å SETTE
 * den via devtools, curl eller en proxy. Enhver innlogget bruker kunne dermed
 * hoppe over abonnementssjekken permanent — RLS beskyttet fortsatt dataene,
 * men betalingsmuren var i praksis frivillig.
 *
 * Verdien signeres nå med HMAC-SHA256 over `userId|sessionId|exp`:
 *  - `sessionId` binder cookien til sesjonen, så den dør ved utlogging.
 *  - `exp` håndheves server-side. Nettleserens `maxAge` styres av brukeren og
 *    er derfor ikke en grense i seg selv.
 *  - Uten hemmeligheten kan verdien ikke forfalskes.
 *
 * Uten konfigurert hemmelighet feiler vi LUKKET: `verifyGateCookie` returnerer
 * false, og porten kjører de fulle sjekkene. Navigasjonen blir da tregere —
 * aldri mindre sikker.
 *
 * Kjører i edge-runtime (middleware), så kun Web Crypto — ingen node:crypto.
 */

const encoder = new TextEncoder()

/**
 * Egen hemmelighet er å foretrekke, men vi faller tilbake på eksisterende
 * server-hemmeligheter så hurtigveien ikke stilner av seg selv i miljøer der
 * GATE_COOKIE_SECRET ennå ikke er satt. Alle tre er høy-entropi og finnes kun
 * server-side (aldri NEXT_PUBLIC_*).
 */
function getSecret(): string | null {
  const secret =
    process.env.GATE_COOKIE_SECRET ||
    process.env.CRON_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  return secret && secret.length >= 16 ? secret : null
}

// CryptoKey-en avledes kun av en env-variabel (ingen brukerdata), så den kan
// trygt gjenbrukes på tvers av forespørsler i samme isolat. Sparer en
// importKey per navigasjon.
let cachedKey: Promise<CryptoKey> | null = null
let cachedKeySecret: string | null = null

function getKey(secret: string): Promise<CryptoKey> {
  if (!cachedKey || cachedKeySecret !== secret) {
    cachedKeySecret = secret
    cachedKey = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
  }
  return cachedKey
}

// Returnerer ArrayBuffer, ikke Uint8Array: TextEncoder gir `Uint8Array<ArrayBufferLike>`,
// som ikke er tilordnbar til Web Cryptos `BufferSource` (den utelukker SharedArrayBuffer).
function payload(userId: string, sessionId: string, exp: number): ArrayBuffer {
  const bytes = encoder.encode(`${userId}|${sessionId}|${exp}`)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): ArrayBuffer | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const buffer = new ArrayBuffer(binary.length)
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return buffer
  } catch {
    return null
  }
}

/**
 * Lager cookie-verdien `<exp>.<signatur>`. Returnerer null når ingen
 * hemmelighet er konfigurert — kalleren skal da la være å sette cookien, slik
 * at neste navigasjon kjører de fulle sjekkene.
 */
export async function signGateCookie(
  userId: string,
  sessionId: string,
  ttlSeconds: number
): Promise<string | null> {
  const secret = getSecret()
  if (!secret) return null

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  const key = await getKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, payload(userId, sessionId, exp))
  return `${exp}.${toBase64Url(signature)}`
}

/**
 * Sant bare for en cookie som er signert med vår hemmelighet, ikke utløpt, og
 * utstedt til nøyaktig denne brukeren og sesjonen.
 */
export async function verifyGateCookie(
  value: string | undefined,
  userId: string,
  sessionId: string
): Promise<boolean> {
  const secret = getSecret()
  if (!secret || !value) return false

  const separator = value.indexOf('.')
  if (separator <= 0) return false

  const exp = Number(value.slice(0, separator))
  if (!Number.isSafeInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false

  const signature = fromBase64Url(value.slice(separator + 1))
  if (!signature) return false

  const key = await getKey(secret)
  // crypto.subtle.verify sammenligner i konstant tid.
  return crypto.subtle.verify('HMAC', key, signature, payload(userId, sessionId, exp))
}
