import { AppPageShell } from "@/components/app-page-shell"
import { ComingSoon } from "@/components/coming-soon"

export default function Page() {
  return (
    <AppPageShell segments={["Min Bedrift", "Bedriftsinnstillinger"]}>
      <ComingSoon
        description="Bedriftsinnstillinger for rettigheter, standardvalg og interne regler kommer snart."
      />
    </AppPageShell>
  )
}
