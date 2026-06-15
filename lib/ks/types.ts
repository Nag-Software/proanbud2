import type { ChecklistResponse, ChecklistStatus, TemplateLanguage } from "@/lib/ks/constants"

export interface ChecklistTemplateCategory {
  id: string
  slug: string
  name: string
  sort_order: number
}

export interface ChecklistTemplateItem {
  id: string
  template_id: string
  sort_order: number
  title: string
  description: string | null
  requires_photo: boolean
}

export interface ChecklistTemplate {
  id: string
  company_id: string | null
  category_id: string | null
  name: string
  description: string | null
  language: TemplateLanguage
  is_system: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  category?: ChecklistTemplateCategory | null
  items?: ChecklistTemplateItem[]
  item_count?: number
}

export interface ProjectChecklistItem {
  id: string
  checklist_id: string
  company_id: string
  sort_order: number
  title: string
  description: string | null
  requires_photo: boolean
  response: ChecklistResponse | null
  comment: string | null
  responded_by: string | null
  responded_at: string | null
  deviation_id: string | null
  created_at: string
  updated_at: string
  attachments?: ChecklistItemAttachment[]
  responder?: { id: string; full_name: string } | null
}

export interface ChecklistItemAttachment {
  id: string
  item_id: string
  company_id: string
  uploaded_by: string
  file_name: string
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  annotation_json: Record<string, unknown> | null
  created_at: string
}

export interface ProjectChecklist {
  id: string
  company_id: string
  project_id: string
  template_id: string | null
  name: string
  status: ChecklistStatus
  created_by: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  items?: ProjectChecklistItem[]
  creator?: { id: string; full_name: string } | null
  progress?: {
    total: number
    answered: number
    ok: number
    notOk: number
    na: number
  }
}

export interface ChecklistSummary extends ProjectChecklist {
  progress: {
    total: number
    answered: number
    ok: number
    notOk: number
    na: number
  }
}
