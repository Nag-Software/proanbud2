import { FIKEN_APP_BASE } from "@/lib/integrations/fiken/config"

// Deep-links into the Fiken web UI for the activity log / external_entity_links.external_url.
// Resources live under /foretak/{slug}/...

export function fikenContactUrl(slug: string, contactId: number) {
  return `${FIKEN_APP_BASE}/foretak/${slug}/kontakter/${contactId}`
}

export function fikenProjectUrl(slug: string, projectId: number) {
  return `${FIKEN_APP_BASE}/foretak/${slug}/prosjekt/${projectId}`
}

export function fikenOfferUrl(slug: string, offerId: number) {
  return `${FIKEN_APP_BASE}/foretak/${slug}/handel/tilbud/${offerId}`
}

export function fikenInvoiceUrl(slug: string, invoiceId: number) {
  return `${FIKEN_APP_BASE}/foretak/${slug}/handel/faktura/${invoiceId}`
}
