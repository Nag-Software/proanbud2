"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { MailIcon, PhoneIcon } from "lucide-react"

import { billingStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { billingStatusLabels, formatDate, formatDateTime, formatRelative } from "@/lib/selger/format"
import type { SellerContactStatus, SelgerTimelineEntry } from "@/lib/selger/types"
import { sellerContactStatusLabels } from "@/lib/selger/types"

type CompanyDetail = {
  id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  org_number: string | null
  created_at: string
  contact_status: SellerContactStatus
  seller_last_contacted_at: string | null
  employee_count: number
  plan_key: string | null
  billing_status: string | null
}

export function FirmaDetailClient({
  company,
  timeline,
}: {
  company: CompanyDetail
  timeline: SelgerTimelineEntry[]
}) {
  const router = useRouter()
  const [contactStatus, setContactStatus] = useState(company.contact_status)
  const [saving, setSaving] = useState(false)

  async function updateContactStatus(status: SellerContactStatus) {
    setSaving(true)
    try {
      const response = await fetch(`/api/selger/companies/${company.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_status: status }),
      })
      if (response.ok) {
        setContactStatus(status)
        router.refresh()
      }
    } finally {
      setSaving(false)
    }
  }

  async function handlePhoneClick() {
    if (!company.phone) return
    void fetch("/api/selger/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: company.id, phone: company.phone }),
    })
    window.location.href = `tel:${company.phone}`
  }

  return (
    <SelgerPageShell segments={["Selger", "Firma", company.company_name]}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <Link href="/selger" className="text-sm text-muted-foreground hover:underline">
              ← Tilbake til oversikt
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{company.company_name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {company.contact_name ?? "Ingen kontaktperson"} · Org.nr {company.org_number ?? "—"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!company.phone} onClick={handlePhoneClick}>
              <PhoneIcon className="mr-2 size-4" />
              Ring
            </Button>
            <Button variant="outline" disabled={!company.email} asChild>
              <Link
                href={`/selger/e-post?company=${company.id}&email=${encodeURIComponent(company.email ?? "")}&name=${encodeURIComponent(company.contact_name ?? company.company_name)}`}
              >
                <MailIcon className="mr-2 size-4" />
                E-post
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardContent className="pt-4 text-sm">
              <p className="text-muted-foreground">E-post</p>
              <p className="mt-1 font-medium">{company.email ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <p className="text-muted-foreground">Telefon</p>
              <p className="mt-1 font-medium">{company.phone ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <p className="text-muted-foreground">Abonnement</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="font-medium uppercase">{company.plan_key ?? "—"}</span>
                <StatusBadge
                  label={
                    billingStatusLabels[company.billing_status ?? "incomplete"] ?? "Ukjent"
                  }
                  variant={billingStatusVariant(company.billing_status)}
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-sm">
              <p className="text-muted-foreground">Ansatte</p>
              <p className="mt-1 font-medium">{company.employee_count}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Kontaktstatus</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={contactStatus}
              onValueChange={(value) => updateContactStatus(value as SellerContactStatus)}
              disabled={saving}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(sellerContactStatusLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Sist kontaktet: {formatDateTime(company.seller_last_contacted_at)} · Opprettet{" "}
              {formatDate(company.created_at)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Aktivitet med selger</CardTitle>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ingen registrert aktivitet ennå.</p>
            ) : (
              <div className="space-y-4">
                {timeline.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{entry.title}</p>
                      {entry.description && (
                        <p className="text-sm text-muted-foreground">{entry.description}</p>
                      )}
                      {entry.seller_email && (
                        <p className="text-xs text-muted-foreground">{entry.seller_email}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {formatRelative(entry.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </SelgerPageShell>
  )
}
