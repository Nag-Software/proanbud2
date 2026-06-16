import { AktivitetClient } from "@/app/selger/aktivitet/aktivitet-client"
import { fetchSelgerEmailLog, fetchSelgerUnifiedActivity } from "@/lib/selger/queries"

export const dynamic = "force-dynamic"

export default async function SelgerAktivitetPage() {
  const [activity, emailLog] = await Promise.all([
    fetchSelgerUnifiedActivity(300),
    fetchSelgerEmailLog(300),
  ])

  return <AktivitetClient activity={activity} emailLog={emailLog} />
}
