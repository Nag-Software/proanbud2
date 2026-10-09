import { AppPageShell } from "@/components/app-page-shell"
import { TimepriserPage } from "@/components/tilbud/timepriser-page"
import { getServerAuthContext } from "@/lib/auth/server-context"
import { isAdmin } from "@/lib/roles"

export const dynamic = "force-dynamic"

export default async function Page() {
  // Layouten slipper inn leder og admin; bare admin får koble ansatte til
  // timepriser (det er i praksis lønnsdata). Lederen ser koblingene.
  const context = await getServerAuthContext()
  const canAssign = isAdmin(context?.role)

  return (
    <AppPageShell segments={["Mine Priser", "Timepriser"]}>
      <TimepriserPage canAssign={canAssign} />
    </AppPageShell>
  )
}
