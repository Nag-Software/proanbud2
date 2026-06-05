import { AppPageShell } from "@/components/app-page-shell"
import { ComingSoon } from "@/components/coming-soon"

export default function Page() {
  return (
    <AppPageShell segments={["Mine Priser", "Lagrede jobber"]}>
      <ComingSoon
        description="Lagrede jobbmaler og gjenbrukbare prisoppsett kommer snart."
      />
    </AppPageShell>
  )
}
