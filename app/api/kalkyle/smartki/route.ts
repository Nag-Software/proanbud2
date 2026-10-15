import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getUsageSummary, recordUsageEvent, requireActiveSubscription } from "@/lib/billing/guards"
import { logServerError } from "@/lib/errors/log"
import { KALKYLE_ENABLED } from "@/lib/kalkyle/flag"
import { fraLagredeJobber, fraTimepriser } from "@/lib/kalkyle/mine-priser"
import {
  SMARTKI_GRENSER,
  SMARTKI_SVAR_JSON_SCHEMA,
  SMARTKI_SYSTEM_PROMPT,
  byggSmartkiMelding,
  fjernIder,
  parseSmartkiSvar,
  prisfilSokeord,
  smartkiForesporselSkjema,
  smartkiReparasjon,
  tilKalkyleEndringer,
  type PrisfilTreff,
  type SmartkiKontekst,
} from "@/lib/kalkyle/smartki"
import type { Kalkyle } from "@/lib/kalkyle/types"
import { openaiFetch } from "@/lib/llm/openai-fetch"
import { proposeWithRepair, type LlmMessage, type LlmReply } from "@/lib/llm/propose-with-repair"
import { canSendOffers } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"
import { selectRelevantCompanyPriceRows, type CompanyPriceRow } from "@/lib/tilbud/company-price-utils"
import { fetchCompanyHourlyRates } from "@/lib/tilbud/labor"
import { savedJobColumns, withSavedJobHoursFallback, type SavedJobRow } from "@/lib/tilbud/saved-jobs"

export const maxDuration = 120

const ROUTE = "POST /api/kalkyle/smartki"

async function hentPrisfilTreff(supabase: SupabaseClient, companyId: string, sporsmal: string): Promise<PrisfilTreff[]> {
  const ord = prisfilSokeord(sporsmal)
  if (!ord.length) return []
  const { data: filer } = await supabase
    .from("supplier_price_files")
    .select("id, supplier_name")
    .eq("company_id", companyId)
    .eq("status", "ready")
  const leverandor = new Map(
    ((filer ?? []) as Array<{ id: string; supplier_name: string | null }>).map((f) => [f.id, f.supplier_name?.trim() || "Prisfil"])
  )
  if (!leverandor.size) return []
  const { data } = await supabase
    .from("supplier_price_rows")
    .select("id, product, unit, net_price, list_price, category, file_id")
    .eq("company_id", companyId)
    .in("file_id", Array.from(leverandor.keys()))
    .or(ord.map((o) => `product.ilike.%${o}%`).join(","))
    .limit(200)
  const rader = ((data ?? []) as Array<CompanyPriceRow & { file_id: string }>).map((r) => ({
    ...r,
    supplier_name: leverandor.get(r.file_id) ?? "Prisfil",
  }))
  return selectRelevantCompanyPriceRows(rader, sporsmal, SMARTKI_GRENSER.prisfilTreff)
    .map((r) => ({
      id: String(r.id ?? ""),
      produkt: String(r.product ?? "").trim(),
      enhet: String(r.unit ?? "").trim(),
      innpris: Number(r.net_price ?? r.list_price ?? 0),
      leverandor: r.supplier_name ?? "Prisfil",
    }))
    .filter((p) => p.produkt && Number.isFinite(p.innpris) && p.innpris > 0)
}

async function hentLagredeJobber(supabase: SupabaseClient, companyId: string) {
  const { data } = await withSavedJobHoursFallback((withHours) =>
    supabase
      .from("saved_jobs")
      .select(savedJobColumns("id, name, price_nok", withHours))
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .limit(SMARTKI_GRENSER.lagredeJobber)
  )
  return fraLagredeJobber((data ?? []) as unknown as SavedJobRow[])
}

/**
 * Proanbud SmartKI i kalkylen. Kalkylen sendes fra nettleseren (den lagres
 * ikke ennå) og valideres med harde grenser. Svaret er tekst + endringer i
 * kalkylens eget format; ingenting endres før brukeren trykker «Legg inn».
 * Samme oppsett som KI-redigering av tilbud: abonnement, KI-kvote, ett
 * JSON-svar med reparasjonsrunde, feillogg og måling (teller som ai_tilbud).
 */
export async function POST(request: Request) {
  if (!KALKYLE_ENABLED) return NextResponse.json({ error: "Finnes ikke." }, { status: 404 })
  const deadline = Date.now() + (maxDuration - 10) * 1_000
  const subscription = await requireActiveSubscription()
  if (!subscription.ok) return subscription.response
  const { companyId, userId } = subscription.context

  const body = smartkiForesporselSkjema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    // Si hva som er galt: før fikk en for stor kalkyle «Skriv kort …», som ikke hjalp.
    const forStor = body.error.issues.some((i) => i.path[0] === "kalkyle")
    return NextResponse.json(
      {
        error: forStor
          ? `Kalkylen er for stor for SmartKI (over ${SMARTKI_GRENSER.poster} poster eller ${SMARTKI_GRENSER.linjerPerPost} linjer i én post).`
          : "Skriv kort hva du lurer på eller vil endre.",
      },
      { status: 400 }
    )
  }
  const foresporsel = body.data

  try {
    const usage = await getUsageSummary(companyId)
    if ((usage.used ?? 0) >= 1_000) {
      return NextResponse.json({ error: "Du har nådd maksgrensen for KI denne perioden." }, { status: 429 })
    }

    const supabase = await createClient()
    const { data: userRow } = await supabase.from("users").select("role").eq("id", userId).maybeSingle()
    if (!canSendOffers(userRow?.role)) {
      return NextResponse.json({ error: "Du har ikke tilgang til kalkyler." }, { status: 403 })
    }

    const [rates, lagredeJobber, prisfilTreff] = await Promise.all([
      fetchCompanyHourlyRates(supabase, companyId),
      hentLagredeJobber(supabase, companyId),
      hentPrisfilTreff(supabase, companyId, foresporsel.sporsmal),
    ])
    const kontekst: SmartkiKontekst = { timepriser: fraTimepriser(rates), lagredeJobber, prisfilTreff }

    // Egen modell for SmartKI kan settes (OPENAI_KALKYLE_MODEL), som CAD har sin.
    const model = process.env.OPENAI_KALKYLE_MODEL || process.env.OPENAI_MODEL || "gpt-5.2-mini"
    const callModel = async (messages: LlmMessage[], timeoutMs: number): Promise<LlmReply> => {
      const response = await openaiFetch(
        "chat/completions",
        // Strengt skjema: modellen kan ikke svare med feil form på endringene.
        { model, response_format: { type: "json_schema", json_schema: SMARTKI_SVAR_JSON_SCHEMA }, messages },
        { timeoutMs, retries: messages.length > 2 ? 0 : 1 }
      )
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>
        model?: string
      }
      return {
        content: payload.choices?.[0]?.message?.content ?? "",
        model: payload.model,
        finishReason: payload.choices?.[0]?.finish_reason,
      }
    }

    const result = await proposeWithRepair({
      deadline,
      callModel,
      parse: parseSmartkiSvar,
      repairInstruction: smartkiReparasjon,
      messages: [
        { role: "system", content: SMARTKI_SYSTEM_PROMPT },
        { role: "user", content: byggSmartkiMelding({ foresporsel, kontekst }) },
      ],
    })

    if (!result.ok) {
      await logServerError({
        message: "SmartKI (kalkyle) ga ugyldig svar",
        error: new Error("KI returnerte et ugyldig svar"),
        source: "api",
        route: ROUTE,
        statusCode: 422,
        level: "warning",
        companyId,
        userId,
        context: {
          model: result.reply.model || model,
          finishReason: result.reply.finishReason,
          repaired: result.repaired,
          repairError: result.repairError,
          issues: result.issues,
        },
      })
      return NextResponse.json({ error: "SmartKI klarte ikke å svare. Prøv å formulere det litt annerledes." }, { status: 422 })
    }

    const { endringer, avvist } = tilKalkyleEndringer(result.value.endringer, foresporsel.kalkyle as Kalkyle, kontekst)

    const metering = await recordUsageEvent({
      companyId,
      eventType: "ai_tilbud",
      // Nøkkelen lages her, ikke i nettleseren: en id klienten velger kunne
      // gjenbrukes, og da telte bare første kall mot kvoten (ON CONFLICT DO NOTHING).
      // Vi tar betalt etter at svaret er klart, så et nytt forsøk etter en feil koster ikke.
      idempotencyKey: `ai_tilbud_kalkyle:${randomUUID()}`,
      metadata: {
        generation_id: foresporsel.generationId,
        user_id: userId,
        mode: "kalkyle_smartki",
        model: result.reply.model || model,
        repaired: result.repaired,
        endringer: endringer.length,
      },
    })

    const kalkyle = foresporsel.kalkyle as Kalkyle
    return NextResponse.json({
      svar: fjernIder(result.value.svar, kalkyle, kontekst),
      endringer,
      oppfolging: result.value.oppfolging.map((o) => fjernIder(o, kalkyle, kontekst)).filter(Boolean),
      avvist: avvist + result.value.forkastet,
      usage: { used: metering.used, quotaLimit: metering.quota_limit, overage: metering.overage },
    })
  } catch (error) {
    const melding = error instanceof Error ? error.message : String(error)
    const ikkeSattOpp = melding.includes("OPENAI_API_KEY")
    await logServerError({
      message: "SmartKI (kalkyle) feilet",
      error,
      source: "api",
      route: ROUTE,
      statusCode: ikkeSattOpp ? 503 : 500,
      level: "error",
      companyId,
      userId,
    })
    return NextResponse.json(
      { error: ikkeSattOpp ? "SmartKI er ikke satt opp på denne serveren." : "SmartKI klarte ikke å svare nå. Prøv igjen." },
      { status: ikkeSattOpp ? 503 : 500 }
    )
  }
}
