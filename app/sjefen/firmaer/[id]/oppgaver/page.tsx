import { fetchCompanyTasks } from "@/lib/platform/company-content"

import { CompanyTasksClient } from "./oppgaver-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaOppgaverPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const tasks = await fetchCompanyTasks(id)
  return <CompanyTasksClient tasks={tasks} />
}
