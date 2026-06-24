"use server"

import { revalidatePath } from "next/cache"

import {
  closeDeviationSchema,
  createDeviationSchema,
  type CreateDeviationInput,
} from "@/app/avvik/schemas"
import { assertPlanFeature } from "@/lib/billing/server-modules"
import { createClient } from "@/lib/supabase/server"
import { OPEN_DEVIATION_STATUSES } from "@/lib/hms/constants"
import type { DeviationStats, DeviationWithRelations } from "@/lib/hms/types"
import { canManageProjects } from "@/lib/roles"

const DEVIATION_SELECT = `
  *,
  projects(id, name),
  reporter:users!reported_by(id, full_name, email),
  checklist_item:project_checklist_items(
    id,
    title,
    checklist:project_checklists(id, name, project_id)
  )
`

function logSupabaseError(context: string, error: { message?: string; code?: string }) {
  console.error(context, error.message || error.code || error)
}

function isMissingRelationError(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    error.message?.includes("does not exist") ||
    error.message?.includes("Could not find")
  )
}

async function getAuthContext() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) throw new Error("Du må være innlogget")

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.company_id) throw new Error("Fant ikke bedrift")

  return { supabase, user, companyId: profile.company_id, role: profile.role }
}

async function assertCanManageDeviation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  role: string | null,
  projectId: string
) {
  if (canManageProjects(role)) return

  const { data: membership } = await supabase
    .from("project_members")
    .select("access_level")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle()

  if (membership?.access_level === "manager") return

  throw new Error("Du har ikke tilgang til å lukke dette avviket")
}

export async function getDeviationsAction(filters?: {
  projectId?: string
  status?: string
  type?: string
  source?: string
  search?: string
  dateFrom?: string
  dateTo?: string
  sortBy?: "created_at" | "title" | "status" | "type"
  sortDir?: "asc" | "desc"
}) {
  const { supabase, companyId } = await getAuthContext()

  const sortBy = filters?.sortBy || "created_at"
  const ascending = filters?.sortDir === "asc"

  let query = supabase
    .from("deviations")
    .select(DEVIATION_SELECT)
    .eq("company_id", companyId)
    .order(sortBy, { ascending })

  if (filters?.projectId) query = query.eq("project_id", filters.projectId)
  if (filters?.status) query = query.eq("status", filters.status)
  if (filters?.type) query = query.eq("type", filters.type)
  if (filters?.source) query = query.eq("source", filters.source)
  if (filters?.dateFrom) query = query.gte("created_at", filters.dateFrom)
  if (filters?.dateTo) query = query.lte("created_at", filters.dateTo)

  let { data, error } = await query

  if (error && isMissingRelationError(error)) return []

  if (error) {
    let fallbackQuery = supabase
      .from("deviations")
      .select("*, projects(id, name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })

    if (filters?.projectId) fallbackQuery = fallbackQuery.eq("project_id", filters.projectId)
    if (filters?.status) fallbackQuery = fallbackQuery.eq("status", filters.status)
    if (filters?.type) fallbackQuery = fallbackQuery.eq("type", filters.type)

    const result = await fallbackQuery
    data = result.data
    error = result.error
  }

  if (error) {
    logSupabaseError("getDeviationsAction:", error)
    throw new Error(error.message || "Kunne ikke hente avvik")
  }

  let results = (data || []) as DeviationWithRelations[]

  if (filters?.search) {
    const q = filters.search.toLowerCase()
    results = results.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.reference_number.toLowerCase().includes(q)
    )
  }

  return results
}

export async function getDeviationByIdAction(id: string) {
  const { supabase, companyId } = await getAuthContext()

  let { data, error } = await supabase
    .from("deviations")
    .select(`${DEVIATION_SELECT}, attachments:deviation_attachments(*)`)
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle()

  if (error && isMissingRelationError(error)) throw new Error("Fant ikke avvik")

  if (error) {
    const fallback = await supabase
      .from("deviations")
      .select("*, projects(id, name), attachments:deviation_attachments(*)")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle()
    data = fallback.data
    error = fallback.error
  }

  if (error || !data) throw new Error("Fant ikke avvik")

  return data as DeviationWithRelations
}

export async function getDeviationStatsAction(): Promise<DeviationStats> {
  const { supabase, companyId } = await getAuthContext()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: deviations, error } = await supabase
    .from("deviations")
    .select("id, status, type, created_at")
    .eq("company_id", companyId)

  if (error) {
    return { openCount: 0, closedCount: 0, ruhLast30Days: 0 }
  }

  const rows = deviations || []
  return {
    openCount: rows.filter((d) => OPEN_DEVIATION_STATUSES.includes(d.status as "open")).length,
    closedCount: rows.filter((d) => d.status === "closed").length,
    ruhLast30Days: rows.filter((d) => d.type === "ruh" && d.created_at >= thirtyDaysAgo).length,
  }
}

export async function getOpenDeviationCountAction() {
  const stats = await getDeviationStatsAction()
  return stats.openCount
}

export async function getAccessibleProjectsAction() {
  const { supabase, user, companyId, role } = await getAuthContext()

  if (canManageProjects(role)) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status")
      .eq("company_id", companyId)
      .in("status", ["planning", "active", "on_hold"])
      .order("name")
    return data || []
  }

  const { data: memberships } = await supabase
    .from("project_members")
    .select("project_id, projects(id, name, status)")
    .eq("user_id", user.id)

  return (memberships || [])
    .map((m) => (Array.isArray(m.projects) ? m.projects[0] : m.projects))
    .filter((p) => p && ["planning", "active", "on_hold"].includes(p.status))
}

export async function createDeviationAction(input: CreateDeviationInput) {
  const parsed = createDeviationSchema.parse(input)
  const { supabase, user, companyId } = await getAuthContext()
  await assertPlanFeature(companyId, "avvik", "Avvik")

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", parsed.projectId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!project) throw new Error("Ugyldig prosjekt")

  const { data, error } = await supabase
    .from("deviations")
    .insert({
      company_id: companyId,
      project_id: parsed.projectId,
      reference_number: "",
      type: parsed.type,
      status: "open",
      title: parsed.title,
      description: parsed.description,
      location_text: parsed.locationText || null,
      reported_by: user.id,
      checklist_item_id: parsed.checklistItemId || null,
      source: parsed.source || "manual",
    })
    .select("id, reference_number")
    .single()

  if (error || !data) {
    logSupabaseError("createDeviationAction:", error || {})
    throw new Error("Kunne ikke opprette avvik")
  }

  if (parsed.checklistItemId) {
    await supabase
      .from("project_checklist_items")
      .update({ deviation_id: data.id })
      .eq("id", parsed.checklistItemId)
  }

  revalidatePath("/avvik")
  revalidatePath(`/prosjekter/${parsed.projectId}`)
  return data
}

export async function closeDeviationAction(input: { id: string; followUpNotes?: string }) {
  const parsed = closeDeviationSchema.parse(input)
  const { supabase, user, companyId, role } = await getAuthContext()
  await assertPlanFeature(companyId, "avvik", "Avvik")

  const { data: existing } = await supabase
    .from("deviations")
    .select("id, project_id")
    .eq("id", parsed.id)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!existing) throw new Error("Fant ikke avvik")
  await assertCanManageDeviation(supabase, user.id, role, existing.project_id)

  const { error } = await supabase
    .from("deviations")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: user.id,
      follow_up_notes: parsed.followUpNotes || null,
    })
    .eq("id", parsed.id)

  if (error) throw new Error("Kunne ikke lukke avvik")

  revalidatePath("/avvik")
  revalidatePath(`/avvik/${parsed.id}`)
  revalidatePath(`/prosjekter/${existing.project_id}`)
}

export async function uploadDeviationPhotoAction(formData: FormData) {
  const { supabase, user, companyId } = await getAuthContext()
  await assertPlanFeature(companyId, "avvik", "Avvik")

  const deviationId = String(formData.get("deviationId") || "")
  const file = formData.get("file") as File | null

  if (!deviationId || !file) throw new Error("Mangler avvik eller fil")

  const { data: deviation } = await supabase
    .from("deviations")
    .select("id, project_id")
    .eq("id", deviationId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!deviation) throw new Error("Fant ikke avvik")

  const ext = file.name.split(".").pop() || "jpg"
  const storagePath = `${companyId}/${deviation.project_id}/${deviationId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from("hms_avvik")
    .upload(storagePath, file, { contentType: file.type, upsert: false })

  if (uploadError) throw new Error("Kunne ikke laste opp bilde")

  const { error: insertError } = await supabase.from("deviation_attachments").insert({
    deviation_id: deviationId,
    company_id: companyId,
    uploaded_by: user.id,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
  })

  if (insertError) throw new Error("Kunne ikke lagre vedlegg")

  revalidatePath(`/avvik/${deviationId}`)
}

export async function getDeviationPhotoUrlAction(storagePath: string) {
  const { supabase } = await getAuthContext()
  const { data } = await supabase.storage.from("hms_avvik").createSignedUrl(storagePath, 3600)
  return data?.signedUrl || null
}

export async function getDeviationExportDataAction(id: string) {
  return getDeviationByIdAction(id)
}
