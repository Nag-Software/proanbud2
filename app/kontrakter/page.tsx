import { AppPageShell } from "@/components/app-page-shell"
import { createClient } from "@/lib/supabase/server"
import { formatNok } from "@/lib/tilbud/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileSignature, FileText, CalendarDays, ExternalLink } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ContractProviderSelector } from "./contract-provider-selector"

export default async function KontrakterPage() {
  const supabase = await createClient()

  // Sjekk brukerens rettigheter
  const { data: { user } } = await supabase.auth.getUser()
  
  let canManageIntegration = false
  let companyId = ""
  let contractProvider: string | null = null

  if (user) {
    const { data: userRow } = await supabase
      .from("users")
      .select("role, company_id")
      .eq("id", user.id)
      .maybeSingle()

    canManageIntegration = userRow?.role === "admin"
    companyId = userRow?.company_id || ""
    
    if (companyId) {
      const { data: company } = await supabase
        .from("companies")
        .select("contract_provider")
        .eq("id", companyId)
        .maybeSingle()
      
      contractProvider = company?.contract_provider || null
    }
  }

  // Hent alle offers som har et 'contract' objekt for firmaet
  const { data: offers } = await supabase
    .from("offers")
    .select("id, title, contract, amount_nok, created_at, project_id, customer:customers(name), project:projects(name)")
    .not("contract", "is", null)
    .order("created_at", { ascending: false })

  const contracts = (offers || []).filter(o => o.contract !== null)

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return <Badge className="bg-amber-600">Sendt</Badge>
      case "completed":
        return <Badge className="bg-green-600">Signert</Badge>
      case "voided":
      case "declined":
        return <Badge variant="destructive">Avslått/Annullert</Badge>
      default:
        return <Badge variant="outline" className="capitalize">{status}</Badge>
    }
  }

  const getProviderIcon = (provider: string) => {
    if (provider === "docusign") {
      return <FileSignature className="h-4 w-4 text-blue-500" />
    } else if (provider === "tripletex") {
      return <FileText className="h-4 w-4 text-gray-500" />
    }
    return <FileText className="h-4 w-4 text-muted-foreground" />
  }

  return (
    <AppPageShell segments={["Salg & Økonomi", "Kontrakter"]}>
      <div className="flex flex-col gap-6 pb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Kontrakter</h1>
            <p className="text-sm text-muted-foreground">
              Her ser du oversikten over alle kontrakter og tilbud sendt til signering.
            </p>
          </div>
          {companyId && (
            <ContractProviderSelector 
              initialProvider={contractProvider} 
              canManageIntegration={canManageIntegration} 
            />
          )}
        </div>

        {contracts.length === 0 ? (
          <Card className="flex flex-col items-center justify-center p-12 mt-4 border-dashed">
            <CardContent className="flex flex-col items-center text-center p-0">
              <div className="rounded-full bg-primary/10 p-4 mb-4">
                <FileSignature className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Ingen kontrakter opprettet enda</h2>
              <p className="text-muted-foreground max-w-md mb-6">
                Her vises alle kontraktene som opprettes og sendes via systemet — enten om det er gjennom DocuSign eller Tripletex. Du kan opprette nye fra et prosjekt eller et tilbud.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Button asChild>
                  <Link href="/prosjekter">Gå til prosjekter</Link>
                </Button>
                <Button variant="secondary" asChild>
                  <Link href="/tilbud">Gå til tilbud</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Nylige kontrakter</CardTitle>
                <CardDescription>
                  Du har {contracts.length} kontrakter knyttet til systemet.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {contracts.map((offer: any) => {
                    const contractData = offer.contract || {}
                    const provider = contractData.provider || "ukjent"
                    const sentAt = contractData.sentAt ? new Date(contractData.sentAt).toLocaleDateString("no-NO", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric"
                    }) : "Ikke sendt"

                    return (
                      <div key={offer.id} className="flex flex-col sm:flex-row sm:items-center p-4 sm:p-6 hover:bg-muted/50 transition-colors gap-4">
                        <div className="flex-1 space-y-1">
                          <Link href={`/tilbud/${offer.id}`} className="font-medium hover:underline flex items-center gap-2">
                            {getProviderIcon(provider)}
                            {offer.title || `Kontrakt for Tilbud: ${offer.id.slice(0,8)}`}
                          </Link>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="flex items-center">
                              <CalendarDays className="mr-1 h-3 w-3" />
                              {sentAt}
                            </span>
                            <span className="hidden sm:inline">•</span>
                            <span className="truncate max-w-[200px]">
                              {offer.project?.name || offer.customer?.name || "Uten kobling"}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center justify-between sm:justify-end gap-6 sm:w-auto w-full">
                          <div className="text-left sm:text-right flex flex-col justify-center">
                            <div className="text-sm font-medium">{offer.amount_nok ? formatNok(offer.amount_nok) : "-"}</div>
                            <div className="text-[10px] text-muted-foreground uppercase">{provider}</div>
                          </div>
                          <div className="w-[100px] text-right flex flex-col justify-center gap-1 items-end">
                            {getStatusBadge(contractData.status || "draft")}
                          </div>
                          {contractData.externalUrl && (
                            <Button variant="ghost" size="icon" title="Vis i eksternt system" asChild className="shrink-0 h-8 w-8 ml-1">
                              <a href={contractData.externalUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppPageShell>
  )
}
