import "server-only"

/**
 * Mengdegrunnlag fra prosjektets 3D-modell, til tilbudsgeneratoren.
 *
 * Dette er hele poenget med at modellen ligger på prosjektet: når prosjektlederen
 * har tegnet bygget, skal kalkulatøren slippe å måle på nytt. Vi henter
 * hovedmodellen, regner ut mengdene, og gir KI-en dem som et grunnlag den skal
 * regne FRA — ikke gjette seg til.
 *
 * Teksten er bevisst kort. Den konkurrerer om tegnbudsjettet med prisfilene
 * (jf. 240k-grensen i ai-chat), og et fullt mengdeuttrekk med hver eneste vegg
 * ville fortrengt priser som betyr mer for treffsikkerheten.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import { parseBuildingModel } from "@/lib/cad/schema"
import { computeTakeoff, formatTakeoffForPrompt } from "@/lib/cad/takeoff"

const MAX_PROMPT_CHARS = 6000

export type ModelTakeoffContext = {
  grunnlag: string
  kilde: string
  antallRom: number
  bruksarealM2: number
}

export async function loadProjectModelTakeoff(
  supabase: SupabaseClient,
  projectId: string | null | undefined
): Promise<ModelTakeoffContext | null> {
  if (!projectId) return null

  try {
    const { data } = await supabase
      .from("project_models")
      .select("name, data, status, updated_at")
      .eq("project_id", projectId)
      .eq("status", "ready")
      .order("is_primary", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!data?.data) return null

    const model = parseBuildingModel(data.data, data.name ?? "3D-modell")
    const hasGeometry = model.storeys.some((storey) => storey.walls.length > 0)
    if (!hasGeometry) return null

    const takeoff = computeTakeoff(model)
    const grunnlag = formatTakeoffForPrompt(model, takeoff).slice(0, MAX_PROMPT_CHARS)

    return {
      grunnlag,
      kilde: `3D-modellen på prosjektet (sist endret ${new Date(data.updated_at).toLocaleDateString("nb-NO")})`,
      antallRom: takeoff.totals.roomCount,
      bruksarealM2: takeoff.totals.grossFloorArea,
    }
  } catch {
    // Mengdegrunnlaget er en forbedring, ikke en forutsetning. Feiler det,
    // skal tilbudet fortsatt kunne genereres.
    return null
  }
}
