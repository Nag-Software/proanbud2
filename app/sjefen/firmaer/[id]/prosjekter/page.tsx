import { fetchCompanyProjects } from "@/lib/platform/company-content"

import { CompanyProjectsClient } from "./prosjekter-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaProsjekterPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const projects = await fetchCompanyProjects(id)
  return <CompanyProjectsClient projects={projects} />
}
