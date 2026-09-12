import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity, logSellerEmail } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import {
  countOutreachSentToday,
  getOutreachDailyLimit,
  isOptedOut,
  sendOutreachEmail,
} from "@/lib/outreach/send"
import { resolveBransje } from "@/lib/outreach/bransje"
import { buildExampleOfferUrl, EXAMPLE_OFFER_CTA_LABEL } from "@/lib/outreach/example-offers"
import { checkColdEmailGates, COLD_STATUSES, GATE_REASON_LABELS } from "@/lib/outreach/gates"
import { evaluateProspectGates, type GateProspect } from "@/lib/outreach/regate"

const sendSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(10000),
})

/** Manuell e-post til et lead fra lead-kortet.
 *
 *  Rekkefølgen er lovpålagt viktig: suppresjonssjekken (markedsføringsloven/GDPR)
 *  og kaldportene (ENK, personlige adresser) kjører FØR alt annet, og dagskvoten
 *  (domenevern) gjelder også manuelle kaldsendinger. Avmeldingsfooter +
 *  List-Unsubscribe legges alltid på. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = sendSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Emne og innhold må fylles ut" }, { status: 400 })
  }

  const admin = createAdminClient()
  // select("*") — tåler at db/90-kolonnene (org_form, domain …) ikke finnes ennå.
  const { data: prospect } = await admin.from("prospects").select("*").eq("id", id).maybeSingle()
  if (!prospect) return NextResponse.json({ error: "Fant ikke leadet" }, { status: 404 })
  if (!prospect.email) {
    return NextResponse.json({ error: "Leadet mangler e-postadresse" }, { status: 400 })
  }

  // 1) Suppresjonsliste — avmeldte/bouncede adresser skal ALDRI kontaktes igjen.
  //    Gjelder også firmadomenet: et «nei» fra ola@firma.no stopper post@firma.no.
  const optedOut = await isOptedOut(admin, {
    email: prospect.email,
    orgNumber: prospect.org_number,
    domain: prospect.domain ?? null,
  })
  if (optedOut) {
    return NextResponse.json(
      { error: "Adressen er avmeldt eller har returnert — bruk telefon", code: "opted_out" },
      { status: 403 }
    )
  }

  // 2) Kaldportene (markedsføringsloven § 15). Bare når dette fortsatt er kaldsalg:
  //    har de svart (dialog/demo/trial) eller er kunde, er det en samtale. Dommen
  //    regnes fersk mot Brønnøysund hver gang — en ENK eller en personlig adresse
  //    stoppes her uansett hva som står i databasen.
  const isColdContact = COLD_STATUSES.has(prospect.status) && !prospect.matched_company_id
  if (isColdContact) {
    const outcome = await evaluateProspectGates(admin, prospect as GateProspect)
    const gate = checkColdEmailGates(
      {
        segment: prospect.segment,
        orgForm: outcome.orgForm,
        employeeCount: outcome.employeeCount,
        isExistingCustomer: prospect.is_existing_customer,
        optedOut: outcome.optedOut,
        emailClass: outcome.emailKind,
        hasEmail: true,
      },
      "manual",
    )
    // Lagre den ferske dommen (best effort — mangler db/90, står sendingen likevel).
    await admin
      .from("prospects")
      .update(outcome.update)
      .eq("id", prospect.id)
      .then(({ error }) => {
        if (error) console.warn("[send-email] kunne ikke lagre portdom", error.message)
      })
    if (!gate.ok) {
      return NextResponse.json(
        { error: GATE_REASON_LABELS[gate.reason], code: gate.reason, phoneOnly: gate.phoneOnly },
        { status: 403 }
      )
    }
  }

  // 3) Dagskvote — manuelle kaldsendinger teller mot samme domenevern-kvote.
  const [sentToday, limit] = [await countOutreachSentToday(admin), getOutreachDailyLimit()]
  if (sentToday >= limit) {
    return NextResponse.json(
      { error: `Dagskvoten for utsendinger er nådd (${limit}) — prøv igjen i morgen` },
      { status: 429 }
    )
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin
  const unsubscribeUrl = `${origin}/api/outreach/unsubscribe?p=${prospect.id}`
  const bransje = resolveBransje({
    naceCode: prospect.nace_code,
    naceDescription: prospect.nace_description,
  })

  try {
    const { providerMessageId } = await sendOutreachEmail({
      to: prospect.email,
      subject: parsed.data.subject.trim(),
      body: parsed.data.body.trim(),
      unsubscribeUrl,
      ctaUrl: buildExampleOfferUrl(bransje),
      ctaLabel: EXAMPLE_OFFER_CTA_LABEL,
    })

    const now = new Date().toISOString()

    await logSellerEmail({
      sentBy: auth.user!.id,
      templateId: "selger-manual",
      recipientEmail: prospect.email,
      companyId: prospect.matched_company_id,
      providerMessageId,
      prospectId: prospect.id,
      subject: parsed.data.subject.trim(),
      body: parsed.data.body.trim(),
    })

    // Første kontakt flytter innboks-/kald-leads til «Kontaktet».
    const updates: Record<string, unknown> = {
      last_contacted_at: now,
      last_activity_at: now,
      updated_at: now,
    }
    if (prospect.status === "ny" || prospect.status === "kvalifisert") {
      updates.status = "kontaktet"
      updates.stage_entered_at = now
    }
    await admin.from("prospects").update(updates).eq("id", id)

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "send_email",
      targetType: "prospect",
      targetId: id,
      metadata: { companyName: prospect.name, recipientEmail: prospect.email },
    })

    return NextResponse.json({ ok: true, movedToContacted: Boolean(updates.status) })
  } catch (error) {
    console.error("[selger/leads send-email]", error)
    await logServerError({
      message: "Manuell e-post til lead feilet",
      error,
      source: "api",
      route: "POST /api/selger/leads/[id]/send-email",
      context: { prospectId: id, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Sendingen feilet — prøv igjen" }, { status: 502 })
  }
}
