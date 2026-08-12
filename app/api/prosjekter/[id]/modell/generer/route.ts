import { NextResponse } from "next/server"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"
import { requireActiveSubscription } from "@/lib/billing/guards"
import { generateBuildingModel } from "@/lib/cad/generate"
import { assessModelContext } from "@/lib/cad/model-context"
import { canManageProjects } from "@/lib/roles"

/**
 * Genererer 3D-modellen fra prosjektbeskrivelse + opplastede bilder.
 *
 * `persist: true` brukes fra ny-prosjekt-veiviseren: da skrives modellen rett
 * inn i databasen, med statusfeltet satt underveis, slik at prosjektsiden kan
 * vise «genererer …» selv om brukeren navigerer bort mens det pågår.
 * Fra editoren kjøres den uten persist, så brukeren kan se resultatet før
 * han bestemmer seg for å beholde det.
 */

const bodySchema = z.object({
  modelId: z.string().uuid().optional(),
  instructions: z.string().max(2000).optional(),
  persist: z.boolean().default(false),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  const billing = await requireActiveSubscription()
  if (!billing.ok) return billing.response

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Ikke innlogget" }, { status: 401 })

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!userRow?.company_id) {
    return NextResponse.json({ error: "Fant ikke bedriften din" }, { status: 400 })
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, project_type, budget_nok, site_address, company_id")
    .eq("id", projectId)
    .maybeSingle()

  if (!project || project.company_id !== userRow.company_id) {
    return NextResponse.json({ error: "Fant ikke prosjektet" }, { status: 404 })
  }

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
  if (!canEdit) {
    return NextResponse.json(
      { error: "Du har ikke tilgang til å endre modellen på dette prosjektet." },
      { status: 403 }
    )
  }

  let body: z.infer<typeof bodySchema>
  try {
    body = bodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  // Signerte URL-er til bildene — KI-en må kunne hente dem over HTTP.
  const { data: references } = await supabase
    .from("project_model_references")
    .select("storage_bucket, storage_path")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(6)

  const imageUrls: string[] = []
  for (const reference of references ?? []) {
    const { data: signed } = await supabase.storage
      .from(reference.storage_bucket || "project_models")
      .createSignedUrl(reference.storage_path, 60 * 20)
    if (signed?.signedUrl) imageUrls.push(signed.signedUrl)
  }

  // Uten bilder eller konkret informasjon om bygget stopper vi FØR det opprettes
  // en modell: veiviseren skal ikke etterlate en tom/gjettet 3D-modell på hvert
  // eneste nye prosjekt. Sjekken kjøres etter at bildene er talt opp, siden ett
  // bilde er nok grunnlag i seg selv.
  const context = assessModelContext({
    description: project.description,
    instructions: body.instructions,
    imageCount: imageUrls.length,
  })
  if (!context.ok) {
    return NextResponse.json({ error: context.reason }, { status: 422 })
  }

  const modelId = body.persist ? await resolveModelId(supabase, projectId, userRow.company_id, user.id, project.name) : body.modelId

  if (body.persist && modelId) {
    await supabase
      .from("project_models")
      .update({ status: "generating", generation_error: null })
      .eq("id", modelId)
  }

  const result = await generateBuildingModel({
    projectName: project.name,
    description: project.description ?? "",
    projectType: project.project_type,
    location: project.site_address,
    budgetNok: project.budget_nok,
    imageUrls,
    instructions: body.instructions ?? null,
  })

  if (!result.ok) {
    if (body.persist && modelId) {
      await supabase
        .from("project_models")
        .update({ status: "failed", generation_error: result.error })
        .eq("id", modelId)
    }
    return NextResponse.json({ error: result.error }, { status: 422 })
  }

  if (body.persist && modelId) {
    const { data: current } = await supabase
      .from("project_models")
      .select("revision, data")
      .eq("id", modelId)
      .maybeSingle()

    if (current) {
      // Ta vare på det som lå der før generering — også når det bare var en
      // tom modell. Angre skal alltid være mulig.
      await supabase.from("project_model_versions").insert({
        model_id: modelId,
        company_id: userRow.company_id,
        revision: current.revision,
        label: "Før KI-generering",
        data: current.data,
        created_by: user.id,
      })

      const { error: updateError } = await supabase
        .from("project_models")
        .update({
          data: result.model,
          name: result.model.name,
          source: "ai",
          status: "ready",
          generation_error: null,
          revision: current.revision + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", modelId)

      if (updateError) {
        await logServerError({
          message: "Kunne ikke lagre generert 3D-modell",
          error: updateError,
          source: "api",
          route: "POST /api/prosjekter/[id]/modell/generer",
          context: { projectId, modelId },
        })
        return NextResponse.json({ error: "Modellen ble laget, men kunne ikke lagres." }, { status: 500 })
      }
    }
  }

  return NextResponse.json({
    model: result.model,
    assumptions: result.assumptions,
    usedModel: result.usedModel,
    imageCount: imageUrls.length,
    modelId: modelId ?? null,
  })
}

async function resolveModelId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  companyId: string,
  userId: string,
  projectName: string
) {
  const { data: existing } = await supabase
    .from("project_models")
    .select("id")
    .eq("project_id", projectId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existing) return existing.id as string

  const { data: created } = await supabase
    .from("project_models")
    .insert({
      company_id: companyId,
      project_id: projectId,
      name: projectName,
      status: "generating",
      source: "ai",
      data: {},
      is_primary: true,
      created_by: userId,
    })
    .select("id")
    .single()

  return (created?.id as string | undefined) ?? null
}

export const maxDuration = 300
