export type TripletexSyncState = "connected" | "degraded" | "disconnected"

export type IntegrationJobStatus =
  | "pending"
  | "processing"
  | "retry"
  | "completed"
  | "failed"
  | "dead_letter"

export type TripletexConnectionRow = {
  company_id: string
  consumer_token_enc: string
  employee_token_enc: string
  session_token_enc: string | null
  session_expires_at: string | null
  default_vat_type_id: number | null
  default_account_id: number | null
  sync_state: TripletexSyncState
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  scope_config?: {
    customers?: boolean
    projects?: boolean
    offers?: boolean
    invoices?: boolean
    employees?: boolean
    calendar?: boolean
    documents?: boolean
  }
}

export type IntegrationJobRow = {
  id: number
  company_id: string
  provider: string
  job_type: string
  payload: Record<string, unknown>
  idempotency_key: string
  status: IntegrationJobStatus
  attempt_count: number
  max_attempts: number
  next_run_at: string
  locked_by: string | null
  locked_at: string | null
  rate_limit_reset_at: string | null
  last_error_code: string | null
  last_error_message: string | null
}

export type TripletexCustomerPayload = {
  id?: number
  name: string
  email?: string
  phoneNumber?: string
  organizationNumber?: string
  postalAddress?: {
    addressLine1?: string
    postalCode?: string
    city?: string
  }
}

export type TripletexProjectPayload = {
  id?: number
  name: string
  customer?: {
    id: number
  }
  projectManager?: {
    id: number
  }
  /** YYYY-MM-DD — required by Tripletex for project create/update */
  startDate?: string
  endDate?: string
  isClosed?: boolean
  description?: string
}
