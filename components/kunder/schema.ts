export type CustomerType = "privatperson" | "bedrift"

export type CustomerProject = {
  id: string
  name: string
  status: string | null
  budgetNok: number
  startDate: string | null
  endDate: string | null
  updatedAt: string | null
}

export type Customer = {
  id: string
  type: CustomerType
  name: string
  email: string
  phone: string
  orgNumber?: string
  address: string
  postalCode: string
  city: string
  activeProjects: number
  totalProjects: number
  totalRevenue: number
  lastContact: string | null;
  notes?: string | null;
  acceptanceRate?: number;
  syncStatus?: "synced" | "syncing" | "attention" | "none"
  syncLastSyncedAt?: string | null
  syncExternalUrl?: string | null
  projects?: CustomerProject[]
}
