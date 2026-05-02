import { checkRoleAccess } from "@/lib/auth-utils"

export default async function TilbudLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await checkRoleAccess(["Administrator", "Prosjektleder"]);
  return <>{children}</>
}
