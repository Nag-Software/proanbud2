import type { DeviationStatus, DeviationType } from "@/lib/hms/constants"

export interface Deviation {
  id: string
  company_id: string
  project_id: string
  reference_number: string
  type: DeviationType
  status: DeviationStatus
  title: string
  description: string
  location_text: string | null
  reported_by: string
  follow_up_notes: string | null
  closed_at: string | null
  closed_by: string | null
  created_at: string
  updated_at: string
}

export interface DeviationAttachment {
  id: string
  deviation_id: string
  company_id: string
  uploaded_by: string
  file_name: string
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  created_at: string
}

export interface DeviationWithRelations extends Deviation {
  projects?: { id: string; name: string } | null
  reporter?: { id: string; full_name: string; email: string } | null
  attachments?: DeviationAttachment[]
}

export interface CompanyHms {
  company_id: string
  handbook_content: string
  updated_by: string | null
  updated_at: string
}

export interface DeviationStats {
  openCount: number
  closedCount: number
  ruhLast30Days: number
}
