import crypto from "crypto"

function getEncryptionKey() {
  const raw = process.env.TRIPLETEX_ENCRYPTION_KEY
  if (!raw) {
    throw new Error("TRIPLETEX_ENCRYPTION_KEY is missing")
  }

  const key = Buffer.from(raw, "base64")
  if (key.byteLength !== 32) {
    throw new Error("TRIPLETEX_ENCRYPTION_KEY must be 32 bytes in base64")
  }

  return key
}

export function encryptSecret(value: string) {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

export function decryptSecret(payload: string | null | undefined) {
  if (!payload) return ""

  const key = getEncryptionKey()
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
