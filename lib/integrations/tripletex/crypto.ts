import {
  decryptSecret as decryptSharedSecret,
  encryptSecret as encryptSharedSecret,
} from "@/lib/integrations/shared/crypto"

/**
 * Tripletex-hemmeligheter, kryptert med den delte AES-256-GCM-implementasjonen.
 *
 * Nøkkelen er PINNET til TRIPLETEX_ENCRYPTION_KEY med vilje. Den delte modulen
 * prøver FIKEN_ENCRYPTION_KEY først, og hvis de to nøklene er ulike ville et
 * ubundet kall dekryptere Tripletex-tokens med Fiken-nøkkelen og gjøre hver
 * eneste lagrede tilkobling ubrukelig. Denne filen finnes kun for å holde den
 * bindingen på ett sted — selve algoritmen er ikke lenger duplisert.
 */
const TRIPLETEX_KEY_ENV_VARS = ["TRIPLETEX_ENCRYPTION_KEY"]

export function encryptSecret(value: string) {
  return encryptSharedSecret(value, TRIPLETEX_KEY_ENV_VARS)
}

export function decryptSecret(payload: string | null | undefined) {
  return decryptSharedSecret(payload, TRIPLETEX_KEY_ENV_VARS)
}
