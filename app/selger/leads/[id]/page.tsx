import { notFound } from "next/navigation"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { fetchProspectDetail, fetchProspectTimeline } from "@/lib/selger/queries"
import { fetchProspectDossier } from "@/lib/selger/godkjenning"
import { fetchProspectReplies } from "@/lib/selger/cockpit"
import { LeadRecordClient } from "./lead-record-client"

export const dynamic = "force-dynamic"

export default async function LeadRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ svar?: string }>
}) {
  const { id } = await params
  const { svar } = await searchParams
  const [detail, timeline, dossier, replies] = await Promise.all([
    fetchProspectDetail(id),
    fetchProspectTimeline(id),
    fetchProspectDossier(id),
    fetchProspectReplies(id),
  ])

  if (!detail) notFound()

  return (
    <SelgerPageShell segments={["Selger", "Pipeline", detail.prospect.name]}>
      <LeadRecordClient
        detail={detail}
        initialTimeline={timeline}
        dossier={dossier}
        replies={replies}
        openReplyId={typeof svar === "string" ? svar : null}
      />
    </SelgerPageShell>
  )
}
