import { fetchTodayData } from "@/lib/selger/queries"
import { TodayClient } from "@/app/selger/today-client"

export const dynamic = "force-dynamic"

export default async function SelgerTodayPage() {
  // Dagskøen er oppgavedrevet: forfalte + dagens «neste handlinger» + signaler
  // beregnet fra pipelinen (nye svar, nye trials, trials som utløper, råtnende).
  const { tasks, leads } = await fetchTodayData()

  return <TodayClient initialTasks={tasks} leads={leads} />
}
