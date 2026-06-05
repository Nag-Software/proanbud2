import { AppPageShell } from "@/components/app-page-shell"
import { ComingSoon } from "@/components/coming-soon"

export default function Page() {
  return (
    <AppPageShell segments={["Min Bedrift", "Bedriftsprofil"]}>
      <ComingSoon
        description="Redigering av bedriftsprofil, logo og offentlig firmainformasjon kommer snart."
      />
    </AppPageShell>
  )
}
