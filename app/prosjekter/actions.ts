"use server"

import { revalidatePath } from "next/cache"
import { ZodError } from "zod"

import { createProjectSchema, type CreateProjectInput } from "./ny/removed-project-form-schema"
import { createClient } from "@/lib/supabase/server"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"

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
    throw new Error("Kunne ikke lagre oppgave i databasen")
  }

  revalidatePath(`/prosjekter/${taskData.project_id}`)
  return data
}

export async function updateTaskStatusAction(taskId: string, newStatus: string, projectId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("tasks")
    .update({ status: normalizeTaskStatus(newStatus), updated_at: new Date().toISOString() })
    .eq("id", taskId)

  if (error) {
    console.error("Error updating task status:", error)
    throw new Error("Kunne ikke oppdatere status")
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
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
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
    })
    .select("id")
    .single()

  if (error || !project?.id) {
    console.error("Error creating project:", error)
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
    const { error: memberError } = await supabase.from("project_members").upsert(projectMembers, {
      onConflict: "project_id,user_id",
    })

    if (memberError) {
      console.error("Error creating initial project members:", memberError)
      throw new Error("Prosjektet ble opprettet, men teamet kunne ikke lagres")
    }
  }

  const taskTitles = Array.from(
    new Set((values.task_titles || []).map((title) => title.trim()).filter((title) => title.length >= 2))
  )

  if (taskTitles.length > 0) {
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
      throw new Error("Prosjektet ble opprettet, men oppgaver kunne ikke lagres")
    }
  }

  revalidatePath("/prosjekter")
  revalidatePath(`/prosjekter/${project.id}`)
  revalidatePath("/prosjekter/ny")

  await enqueueIntegrationJob({
    companyId,
    jobType: "project.upsert",
    payload: { companyId, projectId: project.id },
    idempotencyKey: `project:${project.id}:created`,
  })

  return { id: project.id }
}

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
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  const { error } = await supabase
    .from("projects")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)

  if (error) {
    console.error("Error updating project:", error)
    throw new Error("Kunne ikke oppdatere prosjekt")
  }

  revalidatePath(`/prosjekter/${projectId}`)
  revalidatePath(`/prosjekter`)

  await enqueueIntegrationJob({
    companyId: userData.company_id,
    jobType: "project.upsert",
    payload: { companyId: userData.company_id, projectId },
    idempotencyKey: `project:${projectId}:${new Date().toISOString()}`,
  })
}
