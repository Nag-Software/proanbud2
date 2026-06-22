import { APP_BASE_URL } from "@/lib/constants"

import { BRANSJE_KEYS, type BransjeKey } from "@/lib/outreach/bransje"
import { EXAMPLE_OFFERS } from "./data"
import type { ExampleOffer } from "./types"

export type { ExampleOffer } from "./types"

/** All trades we have a pre-made example offer for. */
export const EXAMPLE_OFFER_BRANSJER = BRANSJE_KEYS

/** Button label used when a cold/follow-up email links to an example offer. */
export const EXAMPLE_OFFER_CTA_LABEL = "Se et eksempel-tilbud (laget på ~30 sek)"

export function getExampleOffer(bransje: BransjeKey): ExampleOffer {
  return EXAMPLE_OFFERS[bransje]
}

/** Public, shareable URL for a trade's example offer (used as the cold-email CTA). */
export function buildExampleOfferUrl(bransje: BransjeKey): string {
  return `${APP_BASE_URL}/eksempel-tilbud/${bransje}?utm_source=outreach&utm_medium=email`
}
