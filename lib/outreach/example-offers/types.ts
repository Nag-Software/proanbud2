import type { BransjeKey } from "@/lib/outreach/bransje"
import type { OfferLineItem } from "@/lib/tilbud/types"

/**
 * A curated, pre-made example offer for one construction trade. Rendered on the
 * public /eksempel-tilbud/[bransje] page and linked from cold outreach emails so
 * recipients see a real, finished KI offer for their own trade — "slik ville ditt
 * sett ut". Static, committed data: no DB and no AI call at send/render time.
 */
export type ExampleOffer = {
  bransje: BransjeKey
  /** Headline for the example, e.g. "Maling av enebolig – fasade og innvendig". */
  title: string
  /** Short project name shown in the document header. */
  projectName: string
  /** One-line scope blurb shown under the project. */
  description: string
  /** Customer-message style intro shown italicized in the document. */
  sourceSummary: string
  /** The contractor whose offer this is (the recipient's kind of firm). */
  companyName: string
  /** Example end-customer the offer is addressed to. */
  customerName: string
  customerCity?: string
  lineItems: OfferLineItem[]
}
