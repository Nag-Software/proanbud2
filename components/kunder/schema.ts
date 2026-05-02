export type CustomerType = "privatperson" | "bedrift"

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
  totalRevenue: number
  lastContact: string;
  acceptanceRate?: number;
  syncStatus?: "synced" | "syncing" | "attention" | "none"
  syncLastSyncedAt?: string | null
  syncExternalUrl?: string | null
}
