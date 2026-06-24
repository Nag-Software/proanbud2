"use server"

import { revalidatePath } from "next/cache"

import {
  addChecklistToProjectSchema,
  createDeviationFromItemSchema,
  createTemplateSchema,
  updateChecklistItemSchema,
  updateTemplateSchema,
  type CreateTemplateInput,
  type UpdateTemplateInput,
} from "@/app/ks/schemas"
import { assertPlanFeature } from "@/lib/billing/server-modules"
import { createClient } from "@/lib/supabase/server"
import type { ChecklistSummary, ChecklistTemplate, ProjectChecklist } from "@/lib/ks/types"
import { canManageProjects } from "@/lib/roles"

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

function computeProgress(items: Array<{ response: string | null }>) {
  const total = items.length
  const answered = items.filter((i) => i.response !== null).length
  const ok = items.filter((i) => i.response === "ok").length
  const notOk = items.filter((i) => i.response === "not_ok").length
  const na = items.filter((i) => i.response === "na").length
  return { total, answered, ok, notOk, na }
}

function deriveChecklistStatus(items: Array<{ response: string | null }>) {
  if (items.length === 0) return "not_started" as const
  const answered = items.filter((i) => i.response !== null).length
  if (answered === 0) return "not_started" as const
  if (answered === items.length) return "completed" as const
  return "in_progress" as const
}

function revalidateProjectKs(projectId: string) {
  revalidatePath(`/prosjekter/${projectId}`)
  revalidatePath(`/prosjekter/${projectId}?tab=ks`)
}

// ==========================================
// Templates
// ==========================================

export async function getTemplateCategoriesAction() {
  const { supabase } = await getAuthContext()
  const { data, error } = await supabase
    .from("checklist_template_categories")
    .select("*")
    .order("sort_order")

  if (error && isMissingRelationError(error)) return []
  if (error) throw new Error("Kunne ikke hente kategorier")
  return data || []
}

export async function getTemplatesAction(filters?: { categoryId?: string; search?: string }) {
  const { supabase, companyId } = await getAuthContext()

  let query = supabase
    .from("checklist_templates")
    .select(`
      *,
      category:checklist_template_categories(id, slug, name, sort_order),
      items:checklist_template_items(id)
    `)
    .or(`is_system.eq.true,company_id.eq.${companyId}`)
    .order("name")

  if (filters?.categoryId) {
    query = query.eq("category_id", filters.categoryId)
  }

  const { data, error } = await query

  if (error && isMissingRelationError(error)) return []
  if (error) {
    logSupabaseError("getTemplatesAction:", error)
    throw new Error("Kunne ikke hente maler")
  }

  let templates = (data || []).map((t) => ({
    ...t,
    item_count: Array.isArray(t.items) ? t.items.length : 0,
    items: undefined,
  })) as ChecklistTemplate[]

  if (filters?.search) {
    const q = filters.search.toLowerCase()
    templates = templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q)
    )
  }

  return templates
}

export async function getTemplateByIdAction(id: string) {
  const { supabase, companyId } = await getAuthContext()

  const { data, error } = await supabase
    .from("checklist_templates")
    .select(`
      *,
      category:checklist_template_categories(id, slug, name, sort_order),
      items:checklist_template_items(*)
    `)
    .eq("id", id)
    .or(`is_system.eq.true,company_id.eq.${companyId}`)
    .maybeSingle()

  if (error || !data) throw new Error("Fant ikke mal")

  const items = (data.items || []).sort(
    (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
  )

  return { ...data, items } as ChecklistTemplate
}

export async function createTemplateAction(input: CreateTemplateInput) {
  const parsed = createTemplateSchema.parse(input)
  const { supabase, user, companyId, role } = await getAuthContext()

  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang til å opprette maler")
  await assertPlanFeature(companyId, "ks", "KS")

  const { data: template, error } = await supabase
    .from("checklist_templates")
    .insert({
      company_id: companyId,
      category_id: parsed.categoryId || null,
      name: parsed.name,
      description: parsed.description || null,
      language: parsed.language || "no",
      is_system: false,
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !template) throw new Error("Kunne ikke opprette mal")

  const items = parsed.items.map((item, index) => ({
    template_id: template.id,
    sort_order: index + 1,
    title: item.title,
    description: item.description || null,
    requires_photo: item.requiresPhoto || false,
  }))

  const { error: itemsError } = await supabase.from("checklist_template_items").insert(items)
  if (itemsError) throw new Error("Kunne ikke lagre malpunkter")

  revalidatePath("/min-bedrift/ks")
  return template
}

export async function updateTemplateAction(input: UpdateTemplateInput) {
  const parsed = updateTemplateSchema.parse(input)
  const { supabase, companyId, role } = await getAuthContext()

  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang")
  await assertPlanFeature(companyId, "ks", "KS")

  const { data: existing } = await supabase
    .from("checklist_templates")
    .select("id")
    .eq("id", parsed.id)
    .eq("company_id", companyId)
    .eq("is_system", false)
    .maybeSingle()

  if (!existing) throw new Error("Fant ikke mal")

  const { error } = await supabase
    .from("checklist_templates")
    .update({
      name: parsed.name,
      description: parsed.description || null,
      category_id: parsed.categoryId || null,
      language: parsed.language || "no",
    })
    .eq("id", parsed.id)

  if (error) throw new Error("Kunne ikke oppdatere mal")

  await supabase.from("checklist_template_items").delete().eq("template_id", parsed.id)

  const items = parsed.items.map((item, index) => ({
    template_id: parsed.id,
    sort_order: index + 1,
    title: item.title,
    description: item.description || null,
    requires_photo: item.requiresPhoto || false,
  }))

  await supabase.from("checklist_template_items").insert(items)

  revalidatePath("/min-bedrift/ks")
  return { id: parsed.id }
}

export async function deleteTemplateAction(id: string) {
  const { supabase, companyId, role } = await getAuthContext()

  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang")
  await assertPlanFeature(companyId, "ks", "KS")

  const { error } = await supabase
    .from("checklist_templates")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId)
    .eq("is_system", false)

  if (error) throw new Error("Kunne ikke slette mal")
  revalidatePath("/min-bedrift/ks")
}

// ==========================================
// Project checklists
// ==========================================

export async function getProjectChecklistsAction(projectId: string): Promise<ChecklistSummary[]> {
  const { supabase, companyId } = await getAuthContext()

  const { data, error } = await supabase
    .from("project_checklists")
    .select(`
      *,
      items:project_checklist_items(id, response)
    `)
    .eq("project_id", projectId)
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })

  if (error && isMissingRelationError(error)) return []
  if (error) throw new Error("Kunne ikke hente sjekklister")

  return (data || []).map((cl) => {
    const items = cl.items || []
    return {
      ...cl,
      items: undefined,
      progress: computeProgress(items),
    }
  }) as ChecklistSummary[]
}

export async function getProjectChecklistByIdAction(
  checklistId: string
): Promise<ProjectChecklist> {
  const { supabase, companyId } = await getAuthContext()

  const { data, error } = await supabase
    .from("project_checklists")
    .select(`
      *,
      creator:users!created_by(id, full_name),
      items:project_checklist_items(
        *,
        responder:users!responded_by(id, full_name),
        attachments:checklist_item_attachments(*)
      )
    `)
    .eq("id", checklistId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (error || !data) throw new Error("Fant ikke sjekkliste")

  const items = (data.items || []).sort(
    (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
  )

  return {
    ...data,
    items,
    progress: computeProgress(items),
  } as ProjectChecklist
}

export async function addChecklistToProjectAction(
  input: Parameters<typeof addChecklistToProjectSchema.parse>[0]
) {
  const parsed = addChecklistToProjectSchema.parse(input)
  const { supabase, user, companyId, role } = await getAuthContext()
  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang til kvalitetssikring")
  await assertPlanFeature(companyId, "ks", "KS")

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", parsed.projectId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!project) throw new Error("Ugyldig prosjekt")

  let name = parsed.name || "Ny sjekkliste"
  let templateItems: Array<{
    title: string
    description: string | null
    requires_photo: boolean
    sort_order: number
  }> = []

  if (parsed.templateId) {
    const template = await getTemplateByIdAction(parsed.templateId)
    name = parsed.name || template.name
    templateItems = (template.items || []).map((item, index) => ({
      title: item.title,
      description: item.description,
      requires_photo: item.requires_photo,
      sort_order: index + 1,
    }))
  } else if (parsed.items?.length) {
    templateItems = parsed.items.map((item, index) => ({
      title: item.title,
      description: item.description || null,
      requires_photo: item.requiresPhoto || false,
      sort_order: index + 1,
    }))
  } else {
    throw new Error("Velg en mal eller legg til punkter")
  }

  const { data: checklist, error } = await supabase
    .from("project_checklists")
    .insert({
      company_id: companyId,
      project_id: parsed.projectId,
      template_id: parsed.templateId || null,
      name,
      status: "not_started",
      created_by: user.id,
    })
    .select("id")
    .single()

  if (error || !checklist) throw new Error("Kunne ikke opprette sjekkliste")

  const items = templateItems.map((item) => ({
    checklist_id: checklist.id,
    company_id: companyId,
    sort_order: item.sort_order,
    title: item.title,
    description: item.description,
    requires_photo: item.requires_photo,
  }))

  const { error: itemsError } = await supabase.from("project_checklist_items").insert(items)
  if (itemsError) throw new Error("Kunne ikke kopiere sjekklistepunkter")

  revalidateProjectKs(parsed.projectId)
  return checklist
}

export async function updateChecklistItemAction(
  input: Parameters<typeof updateChecklistItemSchema.parse>[0]
) {
  const parsed = updateChecklistItemSchema.parse(input)
  const { supabase, user, companyId, role } = await getAuthContext()
  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang til kvalitetssikring")
  await assertPlanFeature(companyId, "ks", "KS")

  const { data: item } = await supabase
    .from("project_checklist_items")
    .select("id, checklist_id, requires_photo, checklist:project_checklists(project_id)")
    .eq("id", parsed.itemId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!item) throw new Error("Fant ikke punkt")

  const checklist = Array.isArray(item.checklist) ? item.checklist[0] : item.checklist
  const projectId = checklist?.project_id
  if (!projectId) throw new Error("Fant ikke prosjekt")

  const now = new Date().toISOString()
  const { error } = await supabase
    .from("project_checklist_items")
    .update({
      response: parsed.response,
      comment: parsed.comment ?? null,
      responded_by: parsed.response ? user.id : null,
      responded_at: parsed.response ? now : null,
    })
    .eq("id", parsed.itemId)

  if (error) throw new Error("Kunne ikke lagre svar")

  const { data: allItems } = await supabase
    .from("project_checklist_items")
    .select("response")
    .eq("checklist_id", item.checklist_id)

  const status = deriveChecklistStatus(allItems || [])
  const updatePayload: Record<string, string | null> = { status }

  if (status === "in_progress") {
    updatePayload.started_at = now
  }
  if (status === "completed") {
    updatePayload.completed_at = now
  }

  await supabase.from("project_checklists").update(updatePayload).eq("id", item.checklist_id)

  revalidateProjectKs(projectId)
  revalidatePath(`/prosjekter/${projectId}/ks/${item.checklist_id}`)

  return { status }
}

export async function createDeviationFromChecklistItemAction(
  input: Parameters<typeof createDeviationFromItemSchema.parse>[0]
) {
  const parsed = createDeviationFromItemSchema.parse(input)
  const { supabase, user, companyId, role } = await getAuthContext()
  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang til kvalitetssikring")
  await assertPlanFeature(companyId, "ks", "KS")

  const { data: item } = await supabase
    .from("project_checklist_items")
    .select(`
      id,
      checklist_id,
      title,
      checklist:project_checklists(project_id)
    `)
    .eq("id", parsed.itemId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!item) throw new Error("Fant ikke sjekklistepunkt")

  const checklist = Array.isArray(item.checklist) ? item.checklist[0] : item.checklist
  const projectId = checklist?.project_id
  if (!projectId) throw new Error("Fant ikke prosjekt")

  const { data: deviation, error } = await supabase
    .from("deviations")
    .insert({
      company_id: companyId,
      project_id: projectId,
      reference_number: "",
      type: "ks",
      status: "open",
      title: parsed.title,
      description: parsed.description,
      location_text: parsed.locationText || null,
      reported_by: user.id,
      checklist_item_id: parsed.itemId,
      source: "checklist",
    })
    .select("id, reference_number")
    .single()

  if (error || !deviation) throw new Error("Kunne ikke opprette avvik")

  await supabase
    .from("project_checklist_items")
    .update({ deviation_id: deviation.id })
    .eq("id", parsed.itemId)

  revalidatePath("/avvik")
  revalidateProjectKs(projectId)
  revalidatePath(`/prosjekter/${projectId}/ks/${item.checklist_id}`)

  return deviation
}

// ==========================================
// Photos
// ==========================================

export async function uploadChecklistItemPhotoAction(formData: FormData) {
  const { supabase, user, companyId, role } = await getAuthContext()
  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang til kvalitetssikring")
  await assertPlanFeature(companyId, "ks", "KS")

  const itemId = String(formData.get("itemId") || "")
  const file = formData.get("file") as File | null
  const annotationJson = formData.get("annotationJson") as string | null

  if (!itemId || !file) throw new Error("Mangler punkt eller fil")

  const { data: item } = await supabase
    .from("project_checklist_items")
    .select(`
      id,
      checklist:project_checklists(id, project_id)
    `)
    .eq("id", itemId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!item) throw new Error("Fant ikke punkt")

  const checklist = Array.isArray(item.checklist) ? item.checklist[0] : item.checklist
  if (!checklist) throw new Error("Fant ikke sjekkliste")

  const ext = file.name.split(".").pop() || "jpg"
  const storagePath = `${companyId}/${checklist.project_id}/${checklist.id}/${itemId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from("ks_checklists")
    .upload(storagePath, file, { contentType: file.type, upsert: false })

  if (uploadError) throw new Error("Kunne ikke laste opp bilde")

  const { error: insertError } = await supabase.from("checklist_item_attachments").insert({
    item_id: itemId,
    company_id: companyId,
    uploaded_by: user.id,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type,
    size_bytes: file.size,
    annotation_json: annotationJson ? JSON.parse(annotationJson) : null,
  })

  if (insertError) throw new Error("Kunne ikke lagre vedlegg")

  revalidateProjectKs(checklist.project_id)
  revalidatePath(`/prosjekter/${checklist.project_id}/ks/${checklist.id}`)
}

export async function getChecklistPhotoUrlAction(storagePath: string) {
  const { supabase } = await getAuthContext()
  const { data } = await supabase.storage.from("ks_checklists").createSignedUrl(storagePath, 3600)
  return data?.signedUrl || null
}

export async function deleteChecklistItemPhotoAction(attachmentId: string) {
  const { supabase, companyId, role } = await getAuthContext()
  if (!canManageProjects(role)) throw new Error("Du har ikke tilgang til kvalitetssikring")
  await assertPlanFeature(companyId, "ks", "KS")

  const { data: attachment } = await supabase
    .from("checklist_item_attachments")
    .select("id, storage_path, item:project_checklist_items(checklist:project_checklists(project_id, id))")
    .eq("id", attachmentId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (!attachment) throw new Error("Fant ikke bilde")

  await supabase.storage.from("ks_checklists").remove([attachment.storage_path])
  await supabase.from("checklist_item_attachments").delete().eq("id", attachmentId)

  const item = attachment.item as unknown as {
    checklist: { project_id: string; id: string } | { project_id: string; id: string }[]
  } | null
  const checklist = item?.checklist
    ? Array.isArray(item.checklist)
      ? item.checklist[0]
      : item.checklist
    : null

  if (checklist) {
    revalidateProjectKs(checklist.project_id)
    revalidatePath(`/prosjekter/${checklist.project_id}/ks/${checklist.id}`)
  }
}

export async function getProjectChecklistPhotosAction(projectId: string) {
  const { supabase, companyId } = await getAuthContext()

  const { data, error } = await supabase
    .from("checklist_item_attachments")
    .select(`
      *,
      item:project_checklist_items(
        id,
        title,
        checklist:project_checklists(id, name, project_id)
      )
    `)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })

  if (error && isMissingRelationError(error)) return []

  return (data || []).filter((att) => {
    const item = att.item as {
      checklist: { project_id: string } | { project_id: string }[]
    } | null
    if (!item?.checklist) return false
    const cl = Array.isArray(item.checklist) ? item.checklist[0] : item.checklist
    return cl?.project_id === projectId
  })
}
