import { AppPageShell } from "@/components/app-page-shell"
import { LagredeJobberPage } from "@/components/tilbud/lagrede-jobber-page"

export const dynamic = "force-dynamic"

export default function Page() {
  return (
    <AppPageShell segments={["Mine Priser", "Lagrede jobber"]}>
      <LagredeJobberPage />
    </AppPageShell>
  )
}
