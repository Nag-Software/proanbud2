"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FileSignature, FileText } from "lucide-react";
import { OpprettKontraktDialog } from "./opprett-kontrakt-dialog";

export function KontrakterTab({ projectId, companyId }: { projectId: string; companyId: string }) {
  const supabase = createClient();
  const [provider, setProvider] = useState<"docusign" | "tripletex" | null>(null);
  const [loading, setLoading] = useState(true);
  const [contractsCount, setContractsCount] = useState(0);

  useEffect(() => {
    async function loadData() {
      // 1. Check company preference
      const { data: company } = await supabase
        .from("companies")
        .select("contract_provider")
        .eq("id", companyId)
        .single();

      if (company?.contract_provider) {
        setProvider(company.contract_provider as any);
      } else {
        // Fallback: Check which one is actually connected
        const [docusignRes, tripletexRes] = await Promise.all([
          supabase.from("docusign_connections").select("company_id").eq("company_id", companyId).maybeSingle(),
          supabase.from("tripletex_connections").select("company_id").eq("company_id", companyId).maybeSingle(),
        ]);

        if (docusignRes.data && !tripletexRes.data) {
          setProvider("docusign");
        } else if (tripletexRes.data && !docusignRes.data) {
          setProvider("tripletex");
        } else if (docusignRes.data && tripletexRes.data) {
           // Default to docusign if both exist but no preference
           setProvider("docusign");
        }
      }
      
      setLoading(false);
    }
    loadData();
  }, [projectId, companyId, supabase]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <Loader2 className="animate-spin text-muted-foreground mr-2" /> Henter kontrakter...
        </CardContent>
      </Card>
    );
  }

  if (!provider) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kontrakter & Avtaler</CardTitle>
          <CardDescription>Ingen kontraktsleverandør er valgt</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Du må sette opp DocuSign eller Tripletex for å administrere kontrakter.
          </p>
          <Button variant="outline" asChild>
            <a href="/min-bedrift/integrasjoner">Gå til integrasjoner</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Kontrakter & Avtaler</CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              Leverandør: 
              <Badge variant="outline" className="capitalize">
                {provider === "docusign" ? <FileSignature className="w-3 h-3 mr-1"/> : <FileText className="w-3 h-3 mr-1"/>}
                {provider}
              </Badge>
            </CardDescription>
          </div>
          <OpprettKontraktDialog provider={provider} projectId={projectId} onSuccess={() => setContractsCount(c => c + 1)} />
        </CardHeader>
        <CardContent>
          {contractsCount === 0 ? (
            <div className="rounded-md border p-6 text-center shadow-sm">
               <p className="text-sm text-muted-foreground">
                 Ingen kontrakter er opprettet enda via {provider === "docusign" ? "DocuSign" : "Tripletex"} for dette prosjektet.
               </p>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from({ length: contractsCount }).map((_, i) => (
                <div key={i} className="flex items-center justify-between p-4 border rounded-md">
                  <div className="flex items-center gap-3">
                    {provider === "docusign" ? <FileSignature className="w-5 h-5 text-blue-500" /> : <FileText className="w-5 h-5 text-gray-500" />}
                    <div>
                      <p className="font-medium">Kontrakt #{i + 1}</p>
                      <p className="text-xs text-muted-foreground">Sist oppdatert: I dag</p>
                    </div>
                  </div>
                  <Badge>Under behandling</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
