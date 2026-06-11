import Link from "next/link"

import { AppPageShell } from "@/components/app-page-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"
import Image from "next/image"

export const integrations = [
    {
        name: "Tripletex",
        description: "Koble til Tripletex med én API-brukernøkkel. Synkroniser kunder, prosjekter, tilbud og fakturaer.",
        url: "/min-bedrift/tripletex",
        status: "active",
        logo: "/integrasjoner-logo/tripletex.png"
    },
    {
        name: "DocuSign",
        description: "Send og signer kontrakter elektronisk via DocuSign.",
        url: "/min-bedrift/integrasjoner/docusign",
        status: "active",
        logo: "https://brandlogos.net/wp-content/uploads/2024/04/docusign-logo_brandlogos.net_5wujv.png"
    },
    {
        name: "Fiken",
        description: "Integrasjon med Fiken regnskapssystem. Kommer senere.",
        url: "#",
        status: "kommer senere",
        logo: "/integrasjoner-logo/fiken.png"
    }
];

export default async function IntegrasjonerPage() {
  await checkRoleAccess(["Administrator", "Prosjektleder", "admin", "manager"])
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let companyId: string | null = null
  if (user) {
    const { data: userRow } = await supabase
      .from("users")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle()

    companyId = userRow?.company_id || null
  }

  const connectionResult = companyId
    ? await supabase
        .from("tripletex_connections")
        .select("company_id, sync_state")
        .eq("company_id", companyId)
        .maybeSingle()
    : { data: null as null }

  const hasTripletexConnection = Boolean(
    connectionResult.data?.company_id && connectionResult.data?.sync_state !== "disconnected"
  )

  return (
    <AppPageShell segments={["Min Bedrift", "Integrasjoner"]}>
      <div className="flex flex-col gap-6 pb-8">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Min side</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Integrasjoner</h1>
          <p className="text-sm text-muted-foreground">
            Her vises alle tilgjengelige integrasjoner. Nye integrasjoner legges til fortlopende.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {integrations.map((integration) => {
                const isTripletex = integration.name === "Tripletex"
                const isActive = integration.status === "active" && (!isTripletex || hasTripletexConnection)
                const actionLabel = isTripletex ? (hasTripletexConnection ? "Administrer" : "Koble til") : "Åpne"

                return (
                    <Card key={integration.name} className="">
                      <CardHeader className="mb-auto">
                        <div className="flex items-center justify-between gap-3">
                          <CardTitle className="mb-2">
                            <Image src={integration.logo} alt={`${integration.name} logo`} width={120} height={40} />
                          </CardTitle>
                          <Badge variant={isActive ? "outline" : "secondary"}>
                              <span className="text-xs">
                                  {integration.status === "active" ? isActive ? "Aktiv" : "Tilgjengelig" : "Kommer senere"}
                              </span>
                          </Badge>
                        </div>
                      <CardDescription>
                          {integration.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-start gap-3 mt-auto">
                      {integration.status === "active" ? (
                        <Button asChild variant="default" className="min-w-20">
                            <Link href={integration.url}>
                            {actionLabel}
                            </Link>
                        </Button>
                      ) : (
                        <Button variant="outline" disabled>
                          Ikke tilgjengelig
                        </Button>
                      )}
                    </CardContent>
                </Card>
                )
            })}
        </div>
      </div>
    </AppPageShell>
  )
}
