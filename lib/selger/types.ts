export type SellerContactStatus =
  | "ukontaktet"
  | "kontaktet"
  | "oppfolging"
  | "demo"
  | "kunde"
  | "avslaatt"

export type SelgerCompanyListRow = {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  plan_key: string | null
  billing_status: string | null
  employee_count: number
  created_at: string
  contact_status: SellerContactStatus
  seller_last_contacted_at: string | null
}

export type SelgerCompanyFilters = {
  q?: string
  plan?: string
  billingStatus?: string
  contactStatus?: string
  createdFrom?: string
  createdTo?: string
}

export type SelgerDashboardStats = {
  totalCompanies: number
  proffSubscriptions: number
  uncontacted: number
  newLast7Days: number
}

export type SelgerActivityRow = {
  id: string
  action: string
  target_type: string | null
  target_id: string | null
  company_id: string | null
  company_name: string | null
  metadata: Record<string, unknown>
  created_at: string
  seller_email: string | null
}

export type SelgerEmailLogRow = {
  id: string
  template_id: string
  recipient_email: string
  company_id: string | null
  company_name: string | null
  created_at: string
  sent_by_email: string | null
}

export type SelgerTimelineEntry = {
  id: string
  kind: "activity" | "email" | "call"
  title: string
  description: string | null
  created_at: string
  seller_email: string | null
}

export const sellerContactStatusLabels: Record<SellerContactStatus, string> = {
  ukontaktet: "Ukontaktet",
  kontaktet: "Kontaktet",
  oppfolging: "Oppfølging",
  demo: "Demo",
  kunde: "Kunde",
  avslaatt: "Avslått",
}

export const sellerActionLabels: Record<string, string> = {
  create_company: "Opprettet firma",
  send_email: "Sendte e-post",
  phone_call: "Ringte",
  update_contact_status: "Oppdaterte kontaktstatus",
}
