import type { SupabaseClient } from "@supabase/supabase-js"

import { ACTIVE_PROJECT_STATUSES } from "@/app/prosjekter/project-utils"
import type { PickerProject } from "./project-picker"

type PickerProjectRow = {
  id: string
  name: string
  status: string | null
  customers?: { name: string | null } | { name: string | null }[] | null
}

/** Aktive prosjekter for prosjektvelgeren, sist endret først. */
export async function fetchPickerProjects(supabase: SupabaseClient): Promise<PickerProject[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, name, status, updated_at, customers(name)")
    .in("status", [...ACTIVE_PROJECT_STATUSES])
    .order("updated_at", { ascending: false })

  return ((data || []) as PickerProjectRow[]).map((row) => {
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      customerName: customer?.name || null,
    }
  })
}
