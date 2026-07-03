import { notFound } from "next/navigation"

import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { fetchProspectDetail, fetchProspectTimeline } from "@/lib/selger/queries"
import { LeadRecordClient } from "./lead-record-client"

export const dynamic = "force-dynamic"

export default async function LeadRecordPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [detail, timeline] = await Promise.all([
    fetchProspectDetail(id),
    fetchProspectTimeline(id),
  ])

  if (!detail) notFound()

  return (
    <SelgerPageShell segments={["Selger", "Pipeline", detail.prospect.name]}>
      <LeadRecordClient detail={detail} initialTimeline={timeline} />
    </SelgerPageShell>
  )
}
