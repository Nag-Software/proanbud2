import { AppPageShell } from "@/components/app-page-shell"
import { ComingSoon } from "@/components/coming-soon"

export default function Page() {
  return (
    <AppPageShell segments={["Mine Priser", "Timepriser"]}>
      <ComingSoon
        description="Timepriser for arbeid, roller og standard satser kommer snart."
      />
    </AppPageShell>
  )
}
