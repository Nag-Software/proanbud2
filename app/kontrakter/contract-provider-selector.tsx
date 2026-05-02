"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { FileSignature, FileText } from "lucide-react"
import Image from "next/image"

export function ContractProviderSelector({ 
  initialProvider, 
  canManageIntegration 
}: { 
  initialProvider: string | null
  canManageIntegration: boolean
}) {
  const [provider, setProvider] = useState<string | undefined>(initialProvider || undefined)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/companies/contract-provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
      if (!res.ok) throw new Error("Kunne ikke lagre kontraktleverandør")
      toast.success("Standard kontraktleverandør ble oppdatert.")
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-4 py-2">
      <div className="flex items-center gap-3">
        <Label>Velg Integrasjon:</Label>
        <Select 
          value={provider} 
          onValueChange={setProvider} 
          disabled={!canManageIntegration || saving}
        >
          <SelectTrigger className="w-[180px]">
             <SelectValue placeholder="Velg leverandør" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
                <SelectLabel>Velg leverandør</SelectLabel>
              <SelectItem value="docusign">
                <div className="flex items-center gap-2">
                    <Image alt="" src="https://companieslogo.com/img/orig/DOCU-60cafc67.png" width={10} height={10}/>
                    DocuSign
                </div>
              </SelectItem>
              <SelectItem value="tripletex">

                <div className="flex items-center gap-2">
                    <Image alt="" src="/integrasjoner-logo/tripletex-logo.svg" width={10} height={10}/>
                    Tripletex
                </div>
            </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      
      {canManageIntegration ? (
        <Button size="sm" disabled={saving || (provider === initialProvider)} onClick={handleSave}>
          Lagre
        </Button>
      ) : (
        <span className="text-xs text-amber-600">Kun admin kan endre</span>
      )}
    </div>
  )
}
