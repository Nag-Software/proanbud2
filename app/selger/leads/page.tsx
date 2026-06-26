import { getOutreachFromEmail } from "@/lib/outreach/send"
import { LeadsClient } from "./leads-client"

export const dynamic = "force-dynamic"

export default function SelgerLeadsPage() {
  // Real cold-outreach sender (env-driven) so the UI never lies about which address
  // the engine sends from once a dedicated subdomain is configured.
  return <LeadsClient outreachFrom={getOutreachFromEmail()} />
}
