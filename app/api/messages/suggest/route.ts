import { NextResponse } from "next/server"
import { z } from "zod"

import { companyHasFeature } from "@/lib/billing/server-modules"
import { createClient } from "@/lib/supabase/server"
import { generateMessageReply, type ThreadMessage } from "@/lib/meldinger/suggest-reply"

const bodySchema = z.object({
  customerId: z.string().uuid(),
})

// KI-genereringen er rask (kort svar), men gi litt slingringsmonn på Vercel.
export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    return NextResponse.json({ error: "Company context missing" }, { status: 400 })
  }

  if (!(await companyHasFeature(userRow.company_id, "meldinger_ki"))) {
    return NextResponse.json(
      { error: "KI-svar krever Proff eller modulen «KI-svar i meldinger».", code: "plan_required", feature: "meldinger_ki" },
      { status: 403 }
    )
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "KI er ikke konfigurert" }, { status: 503 })
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const companyId = userRow.company_id

  const [{ data: messages }, { data: customer }, { data: company }] = await Promise.all([
    supabase
      .from("messages")
      .select("sender_type, content, created_at")
      .eq("company_id", companyId)
      .eq("customer_id", parsed.data.customerId)
      .order("created_at", { ascending: true }),
    supabase.from("customers").select("name").eq("id", parsed.data.customerId).eq("company_id", companyId).maybeSingle(),
    supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
  ])

  // Behold de siste meldingene som kontekst, og klipp svært lange meldinger.
  const thread: ThreadMessage[] = (messages ?? [])
    .filter((m) => typeof m.content === "string" && m.content.trim())
    .slice(-25)
    .map((m) => ({
      sender: m.sender_type === "company" ? "company" : "customer",
      content: String(m.content).slice(0, 2000),
    }))

  try {
    const { suggestion } = await generateMessageReply({
      companyName: company?.name ?? null,
      customerName: customer?.name ?? null,
      thread,
    })
    return NextResponse.json({ suggestion })
  } catch (error) {
    console.error("[messages/suggest]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke lage forslag" },
      { status: 500 }
    )
  }
}
