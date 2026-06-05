import { AppPageShell } from "@/components/app-page-shell"
import { ComingSoon } from "@/components/coming-soon"

export default function Page() {
  return (
    <AppPageShell segments={["Innstillinger", "Brukere"]}>
      <ComingSoon
        description="Brukerinnstillinger og personlige tilganger kommer snart."
      />
    </AppPageShell>
  )
}
