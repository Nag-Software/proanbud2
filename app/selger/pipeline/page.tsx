import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { fetchPipelineLeads } from "@/lib/selger/queries"
import { fetchMachineFunnel } from "@/lib/selger/godkjenning"
import { MachineFunnelStrip } from "@/components/selger/machine-funnel"
import { PipelineClient } from "./pipeline-client"

export const dynamic = "force-dynamic"

export default async function SelgerPipelinePage() {
  // fetchPipelineLeads kjører trial-bro-synken først, så selvregistrerte
  // firmaer alltid ligger som kort i brettet.
  const [leads, funnel] = await Promise.all([fetchPipelineLeads(), fetchMachineFunnel()])

  return (
    <SelgerPageShell segments={["Selger", "Pipeline"]} noPadding>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-1">
        {/* Maskinstegene som en stripe — kanban under viser bare menneskestegene. */}
        <MachineFunnelStrip funnel={funnel} />
        <PipelineClient initialLeads={leads} />
      </div>
    </SelgerPageShell>
  )
}
