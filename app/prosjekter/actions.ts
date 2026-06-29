"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"

import { createProjectSchema, type CreateProjectInput } from "./ny/removed-project-form-schema"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueEntityTripletexSync, processTripletexQueueInBackground } from "@/lib/integrations/tripletex/sync"
import { assertPlanFeature, companyHasFeature } from "@/lib/billing/server-modules"
import { canManageProjects } from "@/lib/roles"
import { logServerError } from "@/lib/errors/log"
import { geocodeAddress } from "@/lib/geo/geocode"

const taskStatusToDb: Record<string, string> = {
  "Ikke startet": "todo",
  "Pagar": "in_progress",
  "Til gjennomgang": "review",
  Ferdig: "done",
  todo: "todo",
  in_progress: "in_progress",
  review: "review",
  done: "done",
}

const taskPriorityToDb: Record<string, string> = {
  Lav: "low",
  Medium: "medium",
  Hoy: "high",
  low: "low",
  medium: "medium",
  high: "high",
  urgent: "urgent",
}

function normalizeTaskStatus(status: string | undefined) {
  return taskStatusToDb[status || ""] || "todo"
}

function normalizeTaskPriority(priority: string | undefined) {
  return taskPriorityToDb[priority || ""] || "medium"
}

async function getEffectiveRole(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: userRoleData } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId)
    .maybeSingle()

  const { data: userTableData } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle()

  // @ts-expect-error Supabase nested relation typing
  return userRoleData?.roles?.name || userTableData?.role || null
}

async function assertCanManageProjectTasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string
) {
  const effectiveRole = await getEffectiveRole(supabase, userId)
  if (canManageProjects(effectiveRole)) {
    return
  }

  const { data: membership } = await supabase
    .from("project_members")
    .select("access_level")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle()

  if (membership?.access_level === "manager" || membership?.access_level === "write") {
    return
  }

  throw new Error("Du har ikke tilgang til å administrere oppgaver i dette prosjektet")
}

function getValidationMessage(error: ZodError<CreateProjectInput>) {
  const firstIssue = error.issues[0]
  return firstIssue?.message || "Ugyldige prosjektdata"
}

// ==========================
// TASKS Server Actions
// ==========================

export async function getProjectTasksAction(projectId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("Error fetching tasks:", error)
    await logServerError({
      message: "Kunne ikke hente oppgaver for prosjekt",
      error,
      source: "action",
      route: "getProjectTasksAction",
      context: { projectId },
    })
    return []
  }

  return data
}

export async function createTaskAction(taskData: {
  project_id: string
  title: string
  description?: string
  status: string
  priority: string
  due_date?: string | null
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  await assertPlanFeature(userData.company_id, "project_tasks", "Oppgaver")
  await assertCanManageProjectTasks(supabase, user.id, taskData.project_id)

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      project_id: taskData.project_id,
      company_id: userData.company_id,
      title: taskData.title,
      description: taskData.description || null,
      status: normalizeTaskStatus(taskData.status),
      priority: normalizeTaskPriority(taskData.priority),
      due_date: taskData.due_date ? new Date(taskData.due_date).toISOString() : null,
    })
    .select()
    .single()

  if (error) {
    console.error("Error creating task:", error)
    await logServerError({
      message: "Kunne ikke lagre oppgave i databasen",
      error,
      source: "action",
      route: "createTaskAction",
      context: { projectId: taskData.project_id, companyId: userData.company_id, userId: user.id },
    })
    throw new Error("Kunne ikke lagre oppgave i databasen")
  }

  revalidatePath(`/prosjekter/${taskData.project_id}`)
  return data
}

export async function updateTaskStatusAction(taskId: string, newStatus: string, projectId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  await assertPlanFeature(userData.company_id, "project_tasks", "Oppgaver")
  // Without this, a read-only project member's drag would be silently no-op'd by RLS
  // (no error), leaving the optimistic UI out of sync with the database.
  await assertCanManageProjectTasks(supabase, user.id, projectId)

  const { error } = await supabase
    .from("tasks")
    .update({ status: normalizeTaskStatus(newStatus), updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("company_id", userData.company_id)

  if (error) {
    console.error("Error updating task status:", error)
    await logServerError({
      message: "Kunne ikke oppdatere oppgavestatus",
      error,
      source: "action",
      route: "updateTaskStatusAction",
      context: { projectId, taskId, companyId: userData.company_id, userId: user.id },
    })
    throw new Error("Kunne ikke oppdatere status")
  }

  revalidatePath(`/prosjekter/${projectId}`)
}

export async function updateTaskAction(taskData: {
  id: string
  project_id: string
  title?: string
  description?: string | null
  status?: string
  priority?: string
  due_date?: string | null
  assigned_to?: string | null
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  await assertPlanFeature(userData.company_id, "project_tasks", "Oppgaver")
  await assertCanManageProjectTasks(supabase, user.id, taskData.project_id)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (taskData.title !== undefined) updates.title = taskData.title
  if (taskData.description !== undefined) updates.description = taskData.description || null
  if (taskData.status !== undefined) updates.status = normalizeTaskStatus(taskData.status)
  if (taskData.priority !== undefined) updates.priority = normalizeTaskPriority(taskData.priority)
  if (taskData.due_date !== undefined) {
    updates.due_date = taskData.due_date ? new Date(taskData.due_date).toISOString() : null
  }
  if (taskData.assigned_to !== undefined) updates.assigned_to = taskData.assigned_to || null

  const { data, error } = await supabase
    .from("tasks")
    .update(updates)
    .eq("id", taskData.id)
    .eq("company_id", userData.company_id)
    .select()
    .single()

  if (error) {
    console.error("Error updating task:", error)
    await logServerError({
      message: "Kunne ikke lagre oppgaveendringer",
      error,
      source: "action",
      route: "updateTaskAction",
      context: { projectId: taskData.project_id, taskId: taskData.id, companyId: userData.company_id, userId: user.id },
    })
    throw new Error("Kunne ikke lagre endringene")
  }

  revalidatePath(`/prosjekter/${taskData.project_id}`)
  return data
}

export async function deleteTaskAction(taskId: string, projectId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  await assertCanManageProjectTasks(supabase, user.id, projectId)

  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .eq("company_id", userData.company_id)

  if (error) {
    console.error("Error deleting task:", error)
    await logServerError({
      message: "Kunne ikke slette oppgaven",
      error,
      source: "action",
      route: "deleteTaskAction",
      context: { projectId, taskId, companyId: userData.company_id, userId: user.id },
    })
    throw new Error("Kunne ikke slette oppgaven")
  }

  revalidatePath(`/prosjekter/${projectId}`)
}

// ==========================
// PROJECTS Server Actions
// ==========================

export async function createProjectAction(input: CreateProjectInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn for å opprette et prosjekt")
  }

  const parsed = createProjectSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(getValidationMessage(parsed.error))
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  if (!canManageProjects(userData.role)) {
    throw new Error("Du har ikke tilgang til å opprette prosjekter")
  }

  const companyId = userData.company_id
  const values = parsed.data

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("id", values.customer_id)
    .eq("company_id", companyId)
    .maybeSingle()

  if (customerError || !customer) {
    throw new Error("Den valgte kunden finnes ikke for bedriften din")
  }

  const requestedMemberIds = Array.from(
    new Set([user.id, values.lead_user_id, ...values.member_ids].filter(Boolean))
  ) as string[]

  if (requestedMemberIds.length > 0) {
    const { data: validUsers, error: membersError } = await supabase
      .from("users")
      .select("id")
      .eq("company_id", companyId)
      .in("id", requestedMemberIds)

    if (membersError) {
      throw new Error("Kunne ikke validere prosjektteamet")
    }

    if ((validUsers?.length || 0) !== requestedMemberIds.length) {
      throw new Error("En eller flere valgte brukere er ikke tilgjengelige i bedriften")
    }
  }

  // Geocode the construction-site address so the project lands precisely on the
  // map at the site (not the customer's office). Best-effort — a miss just leaves
  // coords null and the project can be placed later from the map.
  const siteAddress = values.site_address?.trim() || null
  let siteLat: number | null = null
  let siteLng: number | null = null
  if (siteAddress) {
    const hit = await geocodeAddress(siteAddress)
    siteLat = hit?.lat ?? null
    siteLng = hit?.lng ?? null
  }

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      company_id: companyId,
      created_by: user.id,
      name: values.name,
      customer_id: values.customer_id,
      project_type: values.project_type,
      status: values.status,
      start_date: values.start_date,
      end_date: values.end_date ?? null,
      budget_nok: values.budget_nok,
      description: values.description || null,
      site_address: siteAddress,
      lat: siteLat,
      lng: siteLng,
    })
    .select("id")
    .single()

  if (error || !project?.id) {
    console.error("Error creating project:", error)
    await logServerError({
      message: "Kunne ikke opprette prosjekt",
      error,
      source: "action",
      route: "createProjectAction",
      context: { companyId, userId: user.id },
    })
    throw new Error("Kunne ikke opprette prosjekt")
  }

  const projectMembers = requestedMemberIds.map((memberId) => ({
    project_id: project.id,
    user_id: memberId,
    access_level:
      memberId === user.id || (values.lead_user_id && memberId === values.lead_user_id)
        ? "manager"
        : "write",
  }))

  if (projectMembers.length > 0) {
    const adminClient = createAdminClient()
    const { error: memberError } = await adminClient.from("project_members").upsert(projectMembers, {
      onConflict: "project_id,user_id",
    })

    if (memberError) {
      console.error("Error creating initial project members:", memberError)
      await logServerError({
        message: "Prosjektet ble opprettet, men teamet kunne ikke lagres",
        error: memberError,
        source: "action",
        route: "createProjectAction",
        context: { companyId, userId: user.id, projectId: project.id },
      })
      throw new Error("Prosjektet ble opprettet, men teamet kunne ikke lagres")
    }
  }

  const taskTitles = Array.from(
    new Set((values.task_titles || []).map((title) => title.trim()).filter((title) => title.length >= 2))
  )

  if (taskTitles.length > 0 && (await companyHasFeature(companyId, "project_tasks"))) {
    const initialTasks = taskTitles.map((title) => ({
      project_id: project.id,
      company_id: companyId,
      title,
      status: "todo",
      priority: "medium",
      description: null,
      due_date: null,
      assigned_to: null,
    }))

    const { error: taskInsertError } = await supabase.from("tasks").insert(initialTasks)

    if (taskInsertError) {
      console.error("Error creating initial tasks:", taskInsertError)
      await logServerError({
        message: "Prosjektet ble opprettet, men oppgaver kunne ikke lagres",
        error: taskInsertError,
        source: "action",
        route: "createProjectAction",
        context: { companyId, userId: user.id, projectId: project.id },
      })
      throw new Error("Prosjektet ble opprettet, men oppgaver kunne ikke lagres")
    }
  }

  revalidatePath("/prosjekter")
  revalidatePath(`/prosjekter/${project.id}`)
  revalidatePath("/prosjekter/ny")

  await enqueueEntityTripletexSync({
    companyId,
    jobType: "project.upsert",
    payload: { projectId: project.id },
    idempotencyKey: `project:${project.id}:upsert`,
  })
  processTripletexQueueInBackground()

  return { id: project.id }
}

/** Columns that may be edited via updateProjectAction. Anything else is ignored. */
const EDITABLE_PROJECT_FIELDS = [
  "name",
  "description",
  "project_type",
  "status",
  "start_date",
  "end_date",
  "budget_nok",
  "customer_id",
  "site_address",
] as const

export async function updateProjectAction(projectId: string, values: Record<string, unknown>) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  // The project must belong to the caller's company, and the caller must be a
  // company manager/admin or a project member with manager access.
  const { data: existingProject } = await supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle()
  if (!existingProject || existingProject.company_id !== userData.company_id) {
    throw new Error("Ugyldig prosjekt")
  }

  let canManage = canManageProjects(userData.role)
  if (!canManage) {
    const { data: membership } = await supabase
      .from("project_members")
      .select("access_level")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle()
    canManage = membership?.access_level === "manager"
  }
  if (!canManage) {
    throw new Error("Du har ikke tilgang til å endre dette prosjektet")
  }

  // Whitelist editable columns so callers can never set sensitive fields
  // (company_id, created_by, ...) through this action.
  const updates: Record<string, unknown> = {}
  for (const key of EDITABLE_PROJECT_FIELDS) {
    if (key in values) updates[key] = values[key]
  }

  if ("name" in updates) {
    const name = String(updates.name ?? "").trim()
    if (!name) throw new Error("Prosjektnavn kan ikke være tomt")
    updates.name = name
  }
  if ("budget_nok" in updates) {
    const budget = Number(updates.budget_nok)
    updates.budget_nok = Number.isFinite(budget) && budget >= 0 ? Math.round(budget) : 0
  }
  if ("description" in updates) {
    const description = String(updates.description ?? "").trim()
    updates.description = description || null
  }
  if ("start_date" in updates && !updates.start_date) updates.start_date = null
  if ("end_date" in updates && !updates.end_date) updates.end_date = null
  if ("customer_id" in updates && !updates.customer_id) updates.customer_id = null

  // Changing the site address re-geocodes the pin (or clears it when emptied).
  if ("site_address" in updates) {
    const addr = String(updates.site_address ?? "").trim()
    if (!addr) {
      updates.site_address = null
      updates.lat = null
      updates.lng = null
    } else {
      updates.site_address = addr
      const hit = await geocodeAddress(addr)
      updates.lat = hit?.lat ?? null
      updates.lng = hit?.lng ?? null
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("Ingen gyldige felter å oppdatere")
  }

  const { error } = await supabase
    .from("projects")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
    .eq("company_id", userData.company_id)

  if (error) {
    console.error("Error updating project:", error)
    await logServerError({
      message: "Kunne ikke oppdatere prosjekt",
      error,
      source: "action",
      route: "updateProjectAction",
      context: { projectId, companyId: userData.company_id, userId: user.id },
    })
    throw new Error("Kunne ikke oppdatere prosjekt")
  }

  revalidatePath(`/prosjekter/${projectId}`)
  revalidatePath(`/prosjekter`)

  await enqueueEntityTripletexSync({
    companyId: userData.company_id,
    jobType: "project.upsert",
    payload: { projectId },
    idempotencyKey: `project:${projectId}:upsert`,
  })
  processTripletexQueueInBackground()
}
