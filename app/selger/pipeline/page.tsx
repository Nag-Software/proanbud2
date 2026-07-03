import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { fetchPipelineLeads } from "@/lib/selger/queries"
import { PipelineClient } from "./pipeline-client"

export const dynamic = "force-dynamic"

export default async function SelgerPipelinePage() {
  // fetchPipelineLeads kjører trial-bro-synken først, så selvregistrerte
  // firmaer alltid ligger som kort i brettet.
  const leads = await fetchPipelineLeads()

  return (
    <SelgerPageShell segments={["Selger", "Pipeline"]} noPadding>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-1">
        <PipelineClient initialLeads={leads} />
      </div>
    </SelgerPageShell>
  )
}
