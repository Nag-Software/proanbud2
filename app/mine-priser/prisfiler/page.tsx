import { AppPageShell } from "@/components/app-page-shell"
import { PrisfilerPage } from "@/components/tilbud/prisfiler-page"

export const dynamic = "force-dynamic"

export default function Page() {
  return (
    <AppPageShell clientData segments={["Mine Priser", "Prisfiler"]}>
      <PrisfilerPage />
    </AppPageShell>
  )
}
