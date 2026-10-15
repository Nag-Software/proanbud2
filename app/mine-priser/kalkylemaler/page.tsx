import { notFound } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { KalkylemalerSide } from "@/components/kalkyle/kalkylemaler-side"
import { fetchPickerProjects } from "@/app/nytt-tilbud/picker-projects"
import { KALKYLE_ENABLED } from "@/lib/kalkyle/flag"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function Page() {
  // Bak samme flagg som Kalkyle-fanen; malene er mock-data til de får egne tabeller.
  if (!KALKYLE_ENABLED) notFound()
  const supabase = await createClient()
  const prosjekter = await fetchPickerProjects(supabase)

  return (
    <AppPageShell segments={["Mine Priser", "Kalkylemaler"]}>
      <KalkylemalerSide prosjekter={prosjekter} />
    </AppPageShell>
  )
}
