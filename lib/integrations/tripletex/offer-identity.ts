import { formatOfferReference } from "@/lib/tilbud/offer-document"

/** Visible quote number — matches ProAnbud tilbudsreferanse (#ABC12345). */
export function buildTripletexOfferNumber(offerId: string) {
  return formatOfferReference(offerId)
}

/** Stable machine id for Tripletex lookup (full ProAnbud offer UUID). */
export function buildTripletexOfferExternalAccountsNumber(offerId: string) {
  return offerId.trim()
}
