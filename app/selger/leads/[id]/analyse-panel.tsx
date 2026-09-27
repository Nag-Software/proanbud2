"use client"

import Link from "next/link"
import { FlameIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { ProspectDetail } from "@/lib/selger/queries"
import { stopReasonLabel } from "@/lib/outreach/stoppgrunner"
import { formatNok, formatNorwegianDate, WARM_MAX_STEP } from "@/lib/outreach/varm-regler"

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString("no-NO", { day: "numeric", month: "short", timeZone: "Europe/Oslo" })
}

/**
 * Hvor den varme oppfølgingen står, i én setning. Casper skal kunne se på
 * kortet om maskinen jobber med leadet, venter på ham, eller har gitt det fra
 * seg — uten å åpne godkjenningskøen.
 */
function warmStatus(detail: ProspectDetail): { text: string; waitingOnYou: boolean } | null {
  const prospect = detail.prospect
  if (prospect.sequence_kind !== "varm") return null

  if (prospect.sequence_stopped_at) {
    return { text: `Stoppet: ${stopReasonLabel(prospect.sequence_stop_reason) ?? "ukjent grunn"}`, waitingOnYou: false }
  }

  const pending = detail.warmMessages.find((message) => message.status === "til_godkjenning")
  if (pending) {
    return { text: `E-post ${pending.step} av ${WARM_MAX_STEP} venter på godkjenning`, waitingOnYou: true }
  }

  const planned = detail.warmMessages.find((message) => message.status === "godkjent" || message.status === "planlagt")
  if (planned) {
    return {
      text: `E-post ${planned.step} av ${WARM_MAX_STEP} går ${shortDate(planned.scheduled_for) ?? "snart"}`,
      waitingOnYou: false,
    }
  }

  const sent = detail.warmMessages.filter((message) => message.status === "sendt")
  const next = shortDate(prospect.sequence_next_at)
  // Ingen neste tid og ingen melding i kø: den skrives i neste kjøring.
  if (sent.length === 0) {
    return { text: `Første e-post skrives ${next ?? "snart"}`, waitingOnYou: false }
  }
  if (sent.length >= WARM_MAX_STEP) {
    return { text: `Begge e-postene er sendt — lukkes ${next ?? "snart"} hvis ingen svarer`, waitingOnYou: false }
  }
  return {
    text: `E-post ${sent.length} av ${WARM_MAX_STEP} sendt ${shortDate(sent[sent.length - 1].sent_at) ?? ""} · neste skrives ${next ?? "snart"}`,
    waitingOnYou: false,
  }
}

/** Analysen leadet kjørte på proanbud.no, og om vi har lov til å følge opp på e-post. */
export function AnalysePanel({ detail }: { detail: ProspectDetail }) {
  const analyse = detail.analyse
  if (!analyse) return null

  const status = warmStatus(detail)
  const consentAt = shortDate(analyse.consentAt ?? detail.prospect.consent_at)
  const consentEmail = detail.prospect.consent_email ?? (analyse.consentAt ? analyse.email : null)

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Analysen</p>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <FlameIcon className="size-3" />
          Varm
        </Badge>
      </div>

      <div className="space-y-2 px-3.5 py-3 text-xs">
        <p>
          Laget et eksempeltilbud på proanbud.no
          {analyse.submittedAt ? ` ${formatNorwegianDate(analyse.submittedAt)}` : ""}.
        </p>
        {(analyse.jobTitle || analyse.offerTotal !== null) && (
          <p className="rounded-md bg-muted/50 px-2.5 py-2 text-sm">
            {analyse.jobTitle ?? "Ukjent jobb"}
            {analyse.offerTotal !== null && (
              <span className="text-muted-foreground"> · {formatNok(analyse.offerTotal)} kr eks. mva</span>
            )}
          </p>
        )}
      </div>

      <div className="border-t px-3.5 py-3 text-xs">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Oppfølging på e-post
        </p>
        {consentEmail ? (
          <p className="mt-1">
            Ja — {consentEmail} krysset av{consentAt ? ` ${consentAt}` : ""}.
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            Nei. Skjemaet lover at adressen de oppga bare brukes til eksempeltilbudet —{" "}
            {detail.prospect.phone ? "ring dem." : "finn et telefonnummer og ring."}
          </p>
        )}
        {status && (
          <p className="mt-2 font-medium">
            {status.waitingOnYou ? (
              <Link href="/selger/godkjenning" className="underline underline-offset-2">
                {status.text}
              </Link>
            ) : (
              status.text
            )}
          </p>
        )}
      </div>
    </div>
  )
}
