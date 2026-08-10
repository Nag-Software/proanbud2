"use server"

/**
 * Server actions for 3D-modellen på et prosjekt.
 *
 * Samtidighet: lagring bruker optimistisk lås på `revision`. Hvis to
 * prosjektledere har modellen oppe samtidig, får den som lagrer sist beskjed om
 * at noen andre har lagret — i stedet for at arbeidet forsvinner uten et pip.
 * Forrige versjon skrives alltid til `project_model_versions` først, så ingen
 * lagring kan gjøre eldre arbeid uopprettelig.
 */

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"
import { GENERIC_ERROR_MESSAGE } from "@/lib/errors/user-message"
import type { ActionResult } from "@/lib/errors/action-result"
import { canManageProjects } from "@/lib/roles"
import { buildingModelSchema, createEmptyModel, parseBuildingModel, sanitizeModel } from "@/lib/cad/schema"
import type { BuildingModel } from "@/lib/cad/types"

export type ProjectModelRecord = {
  id: string
  name: string
  status: "generating" | "ready" | "failed"
  source: "manual" | "ai" | "import"
  revision: number
  generationError: string | null
  isPrimary: boolean
  data: BuildingModel
  updatedAt: string
}

type ProjectContext =
  | { ok: false; error: string }
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      user: { id: string }
      companyId: string
      project: {
        id: string
        name: string
        description: string | null
        project_type: string | null
        budget_nok: number | null
        company_id: string
      }
      canEdit: boolean
    }

async function resolveContext(projectId: string): Promise<ProjectContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: "Du må være logget inn." }
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!userRow?.company_id) {
    return { ok: false, error: "Fant ikke bedriften din. Last siden på nytt." }
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, project_type, budget_nok, company_id")
    .eq("id", projectId)
    .maybeSingle()

  if (!project || project.company_id !== userRow.company_id) {
    return { ok: false, error: "Fant ikke prosjektet." }
  }

  // Prosjektledere på selve prosjektet skal kunne tegne selv om de ikke er
  // admin/manager i firmaet.
  let canEdit = canManageProjects(userRow.role)
  if (!canEdit) {
    const { data: membership } = await supabase
      .from("project_members")
      .select("access_level")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle()
    canEdit = membership?.access_level === "manager"
  }

  return { ok: true, supabase, user, companyId: userRow.company_id as string, project, canEdit }
}

function toRecord(row: {
  id: string
  name: string
  status: string
  source: string
  revision: number
  generation_error: string | null
  is_primary: boolean
  data: unknown
  updated_at: string
}): ProjectModelRecord {
  return {
    id: row.id,
    name: row.name,
    status: (row.status as ProjectModelRecord["status"]) ?? "ready",
    source: (row.source as ProjectModelRecord["source"]) ?? "manual",
    revision: row.revision ?? 1,
    generationError: row.generation_error,
    isPrimary: row.is_primary,
    data: parseBuildingModel(row.data, row.name),
    updatedAt: row.updated_at,
  }
}

const MODEL_COLUMNS =
  "id, name, status, source, revision, generation_error, is_primary, data, updated_at"

/**
 * Henter prosjektets hovedmodell, og oppretter en tom hvis den ikke finnes.
 * Kalles fra prosjektsiden, så den skal aldri kaste — en feil her skal ikke
 * kunne velte hele prosjektvisningen.
 */
export async function getOrCreateProjectModelAction(
  projectId: string
): Promise<ActionResult<{ model: ProjectModelRecord; canEdit: boolean; referenceImageCount: number }>> {
  try {
    const context = await resolveContext(projectId)
    if (!context.ok) return { ok: false, error: context.error }
    const { supabase, user, companyId, project, canEdit } = context

    const { data: existing } = await supabase
      .from("project_models")
      .select(MODEL_COLUMNS)
      .eq("project_id", projectId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    const { count: referenceImageCount } = await supabase
      .from("project_model_references")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)

    if (existing) {
      // Selvhelbredelse: genereringen kjøres uten å bli ventet på fra
      // veiviseren. Lukker brukeren fanen midt i, blir raden stående som
      // 'generating' for alltid og fanen viser en spinner som aldri tar slutt.
      // Etter 5 minutter regner vi den som mislykket, slik at brukeren får en
      // modell han kan jobbe i — og en knapp for å prøve igjen.
      const isStuck =
        existing.status === "generating" &&
        Date.now() - new Date(existing.updated_at).getTime() > 5 * 60 * 1000

      if (isStuck) {
        const message =
          "Genereringen ble avbrutt. Trykk «Generer på nytt» for å prøve en gang til."
        await supabase
          .from("project_models")
          .update({ status: "failed", generation_error: message })
          .eq("id", existing.id)
          .eq("status", "generating")

        return {
          ok: true,
          data: {
            model: toRecord({ ...existing, status: "failed", generation_error: message }),
            canEdit,
            referenceImageCount: referenceImageCount ?? 0,
          },
        }
      }

      return {
        ok: true,
        data: {
          model: toRecord(existing),
          canEdit,
          referenceImageCount: referenceImageCount ?? 0,
        },
      }
    }

    if (!canEdit) {
      // Håndverkere skal kunne se, men ikke opprette. Gi dem en tom modell i
      // minnet i stedet for en feilmelding.
      return {
        ok: true,
        data: {
          model: {
            id: "",
            name: project.name,
            status: "ready",
            source: "manual",
            revision: 1,
            generationError: null,
            isPrimary: true,
            data: createEmptyModel(project.name),
            updatedAt: new Date().toISOString(),
          },
          canEdit: false,
          referenceImageCount: referenceImageCount ?? 0,
        },
      }
    }

    const { data: created, error } = await supabase
      .from("project_models")
      .insert({
        company_id: companyId,
        project_id: projectId,
        name: project.name,
        status: "ready",
        source: "manual",
        data: createEmptyModel(project.name),
        is_primary: true,
        created_by: user.id,
      })
      .select(MODEL_COLUMNS)
      .single()

    if (error || !created) {
      await logServerError({
        message: "Kunne ikke opprette 3D-modell for prosjekt",
        error,
        source: "action",
        route: "getOrCreateProjectModelAction",
        context: { projectId, companyId },
      })
      return { ok: false, error: "Kunne ikke opprette modellen. Prøv å laste siden på nytt." }
    }

    return {
      ok: true,
      data: { model: toRecord(created), canEdit, referenceImageCount: referenceImageCount ?? 0 },
    }
  } catch (error) {
    await logServerError({
      message: "Uventet feil ved henting av 3D-modell",
      error,
      source: "action",
      route: "getOrCreateProjectModelAction",
      context: { projectId },
    })
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }
}

export async function saveProjectModelAction(input: {
  projectId: string
  modelId: string
  data: BuildingModel
  revision: number
}): Promise<ActionResult<{ revision: number }>> {
  try {
    const context = await resolveContext(input.projectId)
    if (!context.ok) return { ok: false, error: context.error }
    const { supabase, user, companyId, canEdit } = context

    if (!canEdit) {
      return { ok: false, error: "Du har ikke tilgang til å endre modellen på dette prosjektet." }
    }

    const parsed = buildingModelSchema.safeParse(input.data)
    if (!parsed.success) {
      return { ok: false, error: "Modellen kunne ikke lagres fordi den er ugyldig." }
    }
    const clean = sanitizeModel(parsed.data as BuildingModel)

    const { data: current } = await supabase
      .from("project_models")
      .select("id, revision, data, company_id")
      .eq("id", input.modelId)
      .eq("project_id", input.projectId)
      .maybeSingle()

    if (!current || current.company_id !== companyId) {
      return { ok: false, error: "Fant ikke modellen." }
    }

    if (current.revision !== input.revision) {
      return {
        ok: false,
        error:
          "Noen andre har lagret modellen imens. Last siden på nytt før du lagrer, så du ikke overskriver arbeidet deres.",
      }
    }

    // Historikk FØRST: hvis versjonslagringen feiler, vil vi ikke ha
    // overskrevet noe ennå.
    const { error: versionError } = await supabase.from("project_model_versions").insert({
      model_id: current.id,
      company_id: companyId,
      revision: current.revision,
      data: current.data,
      created_by: user.id,
    })

    if (versionError && versionError.code !== "23505") {
      await logServerError({
        message: "Kunne ikke lagre versjonshistorikk for 3D-modell",
        error: versionError,
        source: "action",
        route: "saveProjectModelAction",
        context: { projectId: input.projectId, modelId: input.modelId },
      })
      return { ok: false, error: "Kunne ikke lagre modellen. Prøv igjen om litt." }
    }

    const nextRevision = current.revision + 1
    const { error: updateError } = await supabase
      .from("project_models")
      .update({
        data: clean,
        name: clean.name,
        revision: nextRevision,
        status: "ready",
        generation_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", current.id)
      .eq("revision", input.revision)

    if (updateError) {
      await logServerError({
        message: "Kunne ikke lagre 3D-modell",
        error: updateError,
        source: "action",
        route: "saveProjectModelAction",
        context: { projectId: input.projectId, modelId: input.modelId },
      })
      return { ok: false, error: "Kunne ikke lagre modellen. Prøv igjen om litt." }
    }

    revalidatePath(`/prosjekter/${input.projectId}`)
    return { ok: true, data: { revision: nextRevision } }
  } catch (error) {
    await logServerError({
      message: "Uventet feil ved lagring av 3D-modell",
      error,
      source: "action",
      route: "saveProjectModelAction",
      context: { projectId: input.projectId },
    })
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }
}

export async function listModelVersionsAction(input: {
  projectId: string
  modelId: string
}): Promise<ActionResult<Array<{ id: string; revision: number; createdAt: string }>>> {
  try {
    const context = await resolveContext(input.projectId)
    if (!context.ok) return { ok: false, error: context.error }

    const { data } = await context.supabase
      .from("project_model_versions")
      .select("id, revision, created_at")
      .eq("model_id", input.modelId)
      .order("revision", { ascending: false })
      .limit(20)

    return {
      ok: true,
      data: (data ?? []).map((row) => ({
        id: row.id,
        revision: row.revision,
        createdAt: row.created_at,
      })),
    }
  } catch {
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }
}

export async function restoreModelVersionAction(input: {
  projectId: string
  modelId: string
  versionId: string
}): Promise<ActionResult<{ model: BuildingModel; revision: number }>> {
  try {
    const context = await resolveContext(input.projectId)
    if (!context.ok) return { ok: false, error: context.error }
    const { supabase, canEdit } = context

    if (!canEdit) {
      return { ok: false, error: "Du har ikke tilgang til å endre modellen." }
    }

    const { data: version } = await supabase
      .from("project_model_versions")
      .select("data, model_id")
      .eq("id", input.versionId)
      .maybeSingle()

    if (!version || version.model_id !== input.modelId) {
      return { ok: false, error: "Fant ikke versjonen." }
    }

    const { data: current } = await supabase
      .from("project_models")
      .select("revision")
      .eq("id", input.modelId)
      .maybeSingle()

    const model = parseBuildingModel(version.data)
    const result = await saveProjectModelAction({
      projectId: input.projectId,
      modelId: input.modelId,
      data: model,
      revision: current?.revision ?? 1,
    })

    if (!result.ok) return result
    return { ok: true, data: { model, revision: result.data.revision } }
  } catch {
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }
}
