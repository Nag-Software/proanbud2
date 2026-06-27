import crypto from "crypto"

/**
 * Provider-agnostic AES-256-GCM secret encryption, serialized as `iv.tag.ciphertext`
 * (all base64). Promoted from lib/integrations/tripletex/crypto.ts so Fiken (and any
 * future integration) can share one implementation.
 *
 * Key resolution order: FIKEN_ENCRYPTION_KEY, then TRIPLETEX_ENCRYPTION_KEY. Pass an
 * explicit `envVar` to pin a single key. Fails loudly if no 32-byte base64 key is set —
 * a mismatched/missing key silently bricks every stored connection, so we never default.
 */
function getEncryptionKey(envVars: string[]) {
  for (const name of envVars) {
    const raw = process.env[name]
    if (!raw) continue

    const key = Buffer.from(raw, "base64")
    if (key.byteLength !== 32) {
      throw new Error(`${name} must be 32 bytes in base64`)
    }
    return key
  }

  throw new Error(`Encryption key missing (set one of: ${envVars.join(", ")})`)
}

const DEFAULT_KEY_ENV_VARS = ["FIKEN_ENCRYPTION_KEY", "TRIPLETEX_ENCRYPTION_KEY"]

export function encryptSecret(value: string, envVars: string[] = DEFAULT_KEY_ENV_VARS) {
  const key = getEncryptionKey(envVars)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

export function decryptSecret(payload: string | null | undefined, envVars: string[] = DEFAULT_KEY_ENV_VARS) {
  if (!payload) return ""

  const key = getEncryptionKey(envVars)
  const [ivB64, tagB64, cipherB64] = payload.split(".")
  if (!ivB64 || !tagB64 || !cipherB64) {
    throw new Error("Encrypted payload format is invalid")
  }

  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const ciphertext = Buffer.from(cipherB64, "base64")

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])

  return decrypted.toString("utf8")
}
