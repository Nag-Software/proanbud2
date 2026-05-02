import { checkRoleAccess } from "@/lib/auth-utils"

export default async function InnstillingerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await checkRoleAccess(["Administrator", "Prosjektleder"]);
  return <>{children}</>
}
