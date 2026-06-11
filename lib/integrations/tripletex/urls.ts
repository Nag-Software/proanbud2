const TRIPLETEX_APP_BASE = "https://tripletex.no"

export function tripletexCustomerUrl(externalId: number) {
  return `${TRIPLETEX_APP_BASE}/execute/customerMenu?customerId=${externalId}`
}

export function tripletexProjectUrl(externalId: number) {
  return `${TRIPLETEX_APP_BASE}/execute/projectMenu?projectId=${externalId}`
}

/** Tilbudsoversikt — same project entity with isOffer=true */
export function tripletexOfferUrl(externalId: number) {
  return `${TRIPLETEX_APP_BASE}/execute/projectMenu?projectId=${externalId}&context=offer`
}

export function tripletexOrderUrl(externalId: number) {
  return `${TRIPLETEX_APP_BASE}/execute/orderMenu?orderId=${externalId}`
}

export function tripletexInvoiceUrl(externalId: number) {
  return `${TRIPLETEX_APP_BASE}/execute/invoiceMenu?invoiceId=${externalId}`
}
