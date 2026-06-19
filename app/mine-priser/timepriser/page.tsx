import { AppPageShell } from "@/components/app-page-shell"
import { TimepriserPage } from "@/components/tilbud/timepriser-page"

export const dynamic = "force-dynamic"

export default function Page() {
  return (
    <AppPageShell segments={["Mine Priser", "Timepriser"]}>
      <TimepriserPage />
    </AppPageShell>
  )
}
