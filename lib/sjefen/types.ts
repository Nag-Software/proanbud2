export type SjefenCompanyRow = {
  id: string
  name: string
  org_number: string | null
  email: string | null
  phone: string | null
  created_at: string
  user_count: number
  offer_count: number
  contract_count: number
  billing_status: string | null
  plan_key: string | null
}

export type SjefenUserRow = {
  id: string
  full_name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  company_id: string
  company_name: string
}

export type SjefenOfferRow = {
  id: string
  title: string
  status: string
  amount_nok: number
  created_at: string
  company_id: string
  company_name: string
  customer_name: string | null
  project_name: string | null
  public_slug?: string | null
  recipient_email?: string | null
}

export type SjefenContractRow = {
  id: string
  title: string
  status: string
  amount_nok: number | null
  created_at: string
  signed_at: string | null
  company_id: string
  company_name: string
  offer_id: string
  invoice_status: string
}

export type SjefenMessageRow = {
  id: string
  content: string
  sender_type: "company" | "customer"
  created_at: string
  read_at: string | null
  company_id: string
  company_name: string
  customer_name: string
  offer_id: string | null
}

export type SjefenOverviewStats = {
  companies: number
  users: number
  activeUsers: number
  offers: number
  contracts: number
  invoices: number
  messages: number
  unreadMessages: number
  activeSubscriptions: number
  recentCompanies: SjefenCompanyRow[]
  recentOffers: SjefenOfferRow[]
  recentMessages: SjefenMessageRow[]
}
