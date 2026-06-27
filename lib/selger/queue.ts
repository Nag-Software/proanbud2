// The "I dag" work queue — the heart of the autonomous cockpit.
//
// Unifies three sources of human-required work into ONE ranked feed of typed cards:
//   • approve — AI drafts awaiting human approval (prospect_outreach awaiting_approval)
//   • call    — hot prospects who engaged, or replied/booked a demo
//   • trial   — trialing companies whose trial is about to lapse
//
// Everything else the machine handles itself. Cards are sorted by urgency so the
// seller works top-down and is done.

import { createAdminClient } from "@/lib/supabase/admin"
import { computeLeadScore, heatForProspect, type HeatLevel } from "@/lib/selger/scoring"
import { nextActionForProspect, nextActionForTrial } from "@/lib/selger/next-action"

export type QueueFilter = "all" | "approve" | "call" | "trial"

type CardBase = { urgency: number }

export type ApproveCard = CardBase & {
  kind: "approve"
  id: string // draft id (prospect_outreach.id)
  prospectId: string
  name: string
  email: string | null
  city: string | null
  subject: string
  body: string
}

export type CallCard = CardBase & {
  kind: "call"
  id: string // prospect id
  name: string
  email: string | null
  phone: string | null
  city: string | null
  status: string
  score: number
  heat: HeatLevel
  reasons: string[]
  openCount: number
  clickCount: number
  lastContactedAt: string | null
  verb: string
}

export type TrialCard = CardBase & {
  kind: "trial"
  id: string // company id
  name: string
  email: string | null
  phone: string | null
  daysLeft: number
  trialEndsAt: string
  verb: string
}

export type QueueCard = ApproveCard | CallCard | TrialCard

const DAY_MS = 24 * 60 * 60 * 1000

async function fetchApproveCards(admin: ReturnType<typeof createAdminClient>): Promise<ApproveCard[]> {
  const { data } = await admin
    .from("prospect_outreach")
    .select("id, ai_subject, ai_body, created_at, prospect:prospects(id, name, email, city)")
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: true })
    .limit(50)

  return (data ?? []).map((row) => {
    const p = (Array.isArray(row.prospect) ? row.prospect[0] : row.prospect) as
      | { id: string; name: string; email: string | null; city: string | null }
      | null
    return {
      kind: "approve" as const,
      urgency: 75,
      id: row.id as string,
      prospectId: p?.id ?? "",
      name: p?.name ?? "Ukjent",
      email: p?.email ?? null,
      city: p?.city ?? null,
      subject: (row.ai_subject as string | null) ?? "",
      body: (row.ai_body as string | null) ?? "",
    }
  })
}

async function fetchCallCards(admin: ReturnType<typeof createAdminClient>): Promise<CallCard[]> {
  // Hot (engaged) prospects, plus anyone who replied or booked a demo.
  const { data } = await admin
    .from("prospects")
    .select(
      "id, name, email, phone, city, status, nace_code, nace_description, employee_count, open_count, click_count, last_contacted_at"
    )
    .eq("is_existing_customer", false)
    .or("is_hot.eq.true,status.eq.svar,status.eq.demo")
    // Don't surface already-closed or rejected leads even if they were once hot.
    .not("status", "in", "(kunde,avvist)")
    .order("lead_score", { ascending: false })
    .limit(40)

  return (data ?? []).map((p) => {
    const { score, reasons } = computeLeadScore({
      naceCode: p.nace_code,
      naceDescription: p.nace_description,
      employeeCount: p.employee_count,
      email: p.email,
      status: p.status,
      openCount: p.open_count,
      clickCount: p.click_count,
      lastContactedAt: p.last_contacted_at,
    })
    const action = nextActionForProspect({
      status: p.status,
      email: p.email,
      phone: p.phone,
      openCount: p.open_count,
      clickCount: p.click_count,
      lastContactedAt: p.last_contacted_at,
    })
    return {
      kind: "call" as const,
      // Demo/reply jump above plain hot leads; otherwise rank by score.
      urgency: p.status === "demo" ? 98 : p.status === "svar" ? 95 : Math.min(94, 50 + score / 2),
      id: p.id as string,
      name: p.name as string,
      email: (p.email as string | null) ?? null,
      phone: (p.phone as string | null) ?? null,
      city: (p.city as string | null) ?? null,
      status: p.status as string,
      score,
      heat: heatForProspect({
        openCount: p.open_count,
        clickCount: p.click_count,
        status: p.status,
      }),
      reasons,
      openCount: (p.open_count as number | null) ?? 0,
      clickCount: (p.click_count as number | null) ?? 0,
      lastContactedAt: (p.last_contacted_at as string | null) ?? null,
      verb: action.verb,
    }
  })
}

async function fetchTrialCards(admin: ReturnType<typeof createAdminClient>): Promise<TrialCard[]> {
  const windowEnd = new Date(Date.now() + 5 * DAY_MS).toISOString()
  const { data: billing } = await admin
    .from("company_billing")
    .select("company_id, trial_ends_at")
    .eq("status", "trialing")
    .not("trial_ends_at", "is", null)
    .lte("trial_ends_at", windowEnd)
    .order("trial_ends_at", { ascending: true })
    .limit(30)

  const rows = billing ?? []
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.company_id as string)
  const { data: companies } = await admin.from("companies").select("id, name, email, phone").in("id", ids)
  const byId = new Map((companies ?? []).map((c) => [c.id as string, c]))

  return rows.map((r) => {
    const company = byId.get(r.company_id as string)
    const trialEndsAt = r.trial_ends_at as string
    const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / DAY_MS)
    const action = nextActionForTrial(daysLeft)
    return {
      kind: "trial" as const,
      urgency: Math.max(60, 100 - Math.max(daysLeft, -3) * 8),
      id: r.company_id as string,
      name: (company?.name as string | null) ?? "Ukjent firma",
      email: (company?.email as string | null) ?? null,
      phone: (company?.phone as string | null) ?? null,
      daysLeft,
      trialEndsAt,
      verb: action.verb,
    }
  })
}

export async function fetchWorkQueue(filter: QueueFilter = "all"): Promise<QueueCard[]> {
  const admin = createAdminClient()

  const [approve, call, trial] = await Promise.all([
    filter === "all" || filter === "approve" ? fetchApproveCards(admin) : Promise.resolve([]),
    filter === "all" || filter === "call" ? fetchCallCards(admin) : Promise.resolve([]),
    filter === "all" || filter === "trial" ? fetchTrialCards(admin) : Promise.resolve([]),
  ])

  const all: QueueCard[] = [...approve, ...call, ...trial]
  all.sort((a, b) => b.urgency - a.urgency)
  return all
}

export type QueueCounts = { total: number; approve: number; call: number; trial: number }

export function countQueue(cards: QueueCard[]): QueueCounts {
  return {
    total: cards.length,
    approve: cards.filter((c) => c.kind === "approve").length,
    call: cards.filter((c) => c.kind === "call").length,
    trial: cards.filter((c) => c.kind === "trial").length,
  }
}
