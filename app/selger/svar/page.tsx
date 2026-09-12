import { fetchReplyInbox } from "@/lib/selger/cockpit"
import { SvarClient } from "./svar-client"

export const dynamic = "force-dynamic"

export default async function SelgerSvarPage() {
  const { unmatched, unhandled } = await fetchReplyInbox()
  return <SvarClient unmatched={unmatched} unhandled={unhandled} />
}
