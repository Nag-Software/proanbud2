export type FikenSyncState = "connected" | "degraded" | "disconnected"

export type FikenAuthMode = "oauth" | "personal"

export type FikenVatType =
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "EXEMPT"
  | "EXEMPT_IMPORT_EXPORT"
  | "EXEMPT_REVERSE"
  | "OUTSIDE"
  | "NONE"

export type FikenScopeConfig = {
  contacts: boolean
  projects: boolean
  offers: boolean
  invoices: boolean
  products: boolean
  inbox: boolean
}

export type FikenConnectionRow = {
  id: string
  company_id: string
  access_token_enc: string | null
  refresh_token_enc: string | null
  token_expires_at: string | null
  personal_token_enc: string | null
  auth_mode: FikenAuthMode
  fiken_company_slug: string | null
  fiken_company_name: string | null
  is_test_company: boolean
  default_vat_type: string | null
  default_income_account: string | null
  default_bank_account_code: string | null
  sync_state: FikenSyncState
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  last_payment_poll_date: string | null
  scope_config?: Partial<FikenScopeConfig>
}

// --- Fiken API payloads -----------------------------------------------------

export type FikenAddressPayload = {
  streetAddress?: string
  city?: string
  postCode?: string
  country?: string
}

export type FikenContactPayload = {
  name: string
  email?: string
  organizationNumber?: string
  phoneNumber?: string
  customer?: boolean
  supplier?: boolean
  inactive?: boolean
  address?: FikenAddressPayload
}

export type FikenProjectPayload = {
  name: string
  number: string
  startDate: string
  endDate?: string
  contactId?: number
  description?: string
  completed?: boolean
}

/**
 * Shared draft-line shape used by offers, order confirmations and invoice drafts
 * (Fiken `invoiceishDraftLineRequest`). Amounts are integers in øre (NOK*100).
 */
export type FikenDraftLinePayload = {
  /** Free-text line description (when not a productId line). */
  description?: string
  /** Reference an existing Fiken product instead of a free-text line. */
  productId?: number
  /** Unit price in øre. See mappers.ts for the VAT-inclusive note. */
  unitPrice: number
  quantity: number
  vatType: FikenVatType
  /** Discount as a percentage (0–100). */
  discount?: number
  incomeAccount?: string
}

export type FikenInvoiceLinePayload = FikenDraftLinePayload

export type FikenInvoiceRequest = {
  customerId: number
  issueDate: string
  dueDate: string
  lines: FikenInvoiceLinePayload[]
  projectId?: number
  bankAccountCode?: string
  cash?: boolean
  ourReference?: string
  yourReference?: string
  orderReference?: string
  invoiceText?: string
}

// --- Fiken API reads --------------------------------------------------------

export type FikenCompanyRead = {
  name?: string
  slug?: string
  organizationNumber?: string
  hasApiAccess?: boolean
  testCompany?: boolean
}

export type FikenSalePaymentRead = {
  paymentId?: number
  date?: string
  amount?: number
  amountInNok?: number
}

export type FikenSaleRead = {
  saleId?: number
  saleNumber?: string
  settled?: boolean
  settledDate?: string | null
  totalPaid?: number
  outstandingBalance?: number
  lastModifiedDate?: string
  salePayments?: FikenSalePaymentRead[]
}

/**
 * invoiceResult — we poll GET /invoices?settled=true and key off invoiceId (which we
 * persist in external_entity_links). The embedded `sale` carries settled/settledDate.
 */
export type FikenInvoiceRead = {
  invoiceId?: number
  invoiceNumber?: number
  lastModifiedDate?: string
  sale?: FikenSaleRead
}
