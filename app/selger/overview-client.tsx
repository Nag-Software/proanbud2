"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { MailIcon, PhoneIcon } from "lucide-react"

import { billingStatusVariant, StatusBadge } from "@/components/sjefen/status-badge"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { billingStatusLabels, formatDate } from "@/lib/selger/format"
import type { SelgerCompanyListRow, SelgerDashboardStats } from "@/lib/selger/types"
import { sellerContactStatusLabels } from "@/lib/selger/types"

type OverviewClientProps = {
  stats: SelgerDashboardStats
  initialCompanies: SelgerCompanyListRow[]
}

export function OverviewClient({ stats, initialCompanies }: OverviewClientProps) {
  const router = useRouter()
  const [companies, setCompanies] = useState(initialCompanies)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [plan, setPlan] = useState<string>("all")
  const [billingStatus, setBillingStatus] = useState<string>("all")
  const [contactStatus, setContactStatus] = useState<string>("all")
  const [createdFrom, setCreatedFrom] = useState("")
  const [createdTo, setCreatedTo] = useState("")

  const loadCompanies = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set("q", search.trim())
      if (plan !== "all") params.set("plan", plan)
      if (billingStatus !== "all") params.set("billing_status", billingStatus)
      if (contactStatus !== "all") params.set("contact_status", contactStatus)
      if (createdFrom) params.set("created_from", createdFrom)
      if (createdTo) params.set("created_to", createdTo)

      const response = await fetch(`/api/selger/companies?${params.toString()}`)
      const data = await response.json()
      if (response.ok) {
        setCompanies(data.companies ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [search, plan, billingStatus, contactStatus, createdFrom, createdTo])

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadCompanies()
    }, 300)
    return () => clearTimeout(timer)
  }, [loadCompanies])

  async function handlePhoneClick(event: React.MouseEvent, company: SelgerCompanyListRow) {
    event.stopPropagation()
    if (!company.phone) return

    void fetch("/api/selger/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: company.id, phone: company.phone }),
    })

    window.location.href = `tel:${company.phone}`
  }

  function handleEmailClick(event: React.MouseEvent, company: SelgerCompanyListRow) {
    event.stopPropagation()
    const params = new URLSearchParams({
      company: company.id,
      email: company.email ?? "",
      name: company.contact_name ?? company.company_name,
    })
    router.push(`/selger/e-post?${params.toString()}`)
  }

  return (
    <SelgerPageShell segments={["Selger", "Pipeline"]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alle firmaer på plattformen — søk, filtrer og ta kontakt.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Firmaer totalt", value: stats.totalCompanies },
            { label: "Proff-abonnement", value: stats.proffSubscriptions },
            { label: "Ukontaktet", value: stats.uncontacted },
            { label: "Nye siste 7 dager", value: stats.newLast7Days },
          ].map((item) => (
            <Card key={item.label} className="theme-surface-hero border-0 shadow-none">
              <CardContent className="pt-4">
                <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-2xl font-semibold">{item.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="grid gap-3 lg:grid-cols-7 max-w-4xl">
              <Input
                placeholder="Søk navn, e-post, org.nr..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="lg:col-span-2"
              />
              <Select value={plan} onValueChange={setPlan}>
                <SelectTrigger>
                  <SelectValue placeholder="Plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle planer</SelectItem>
                  <SelectItem value="mini">Mini</SelectItem>
                  <SelectItem value="proff">Proff</SelectItem>
                </SelectContent>
              </Select>
              <Select value={billingStatus} onValueChange={setBillingStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Abonnement" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle statuser</SelectItem>
                  <SelectItem value="trialing">Prøveperiode</SelectItem>
                  <SelectItem value="active">Aktiv</SelectItem>
                  <SelectItem value="incomplete">Ufullstendig</SelectItem>
                  <SelectItem value="past_due">Forfalt</SelectItem>
                  <SelectItem value="canceled">Kansellert</SelectItem>
                </SelectContent>
              </Select>
              <Select value={contactStatus} onValueChange={setContactStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Kontakt" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alle kontakt</SelectItem>
                  {Object.entries(sellerContactStatusLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={createdFrom}
                onChange={(event) => setCreatedFrom(event.target.value)}
                aria-label="Opprettet fra"
              />
              <Input
                type="date"
                value={createdTo}
                onChange={(event) => setCreatedTo(event.target.value)}
                aria-label="Opprettet til"
              />
            </div>

            <p className="text-sm text-muted-foreground">
              {loading ? "Laster..." : `${companies.length} firmaer`}
            </p>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kontakt</TableHead>
                    <TableHead>Firma</TableHead>
                    <TableHead>E-post</TableHead>
                    <TableHead>Abonnement</TableHead>
                    <TableHead>Ansatte</TableHead>
                    <TableHead>Opprettet</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Handling</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies.map((company) => (
                    <TableRow
                      key={company.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/selger/firmaer/${company.id}`)}
                    >
                      <TableCell className="font-medium">
                        {company.contact_name ?? "—"}
                      </TableCell>
                      <TableCell>{company.company_name}</TableCell>
                      <TableCell>{company.email ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="text-xs uppercase">
                            {company.plan_key ?? "—"}
                          </span>
                          <StatusBadge
                            label={
                              billingStatusLabels[company.billing_status ?? "incomplete"] ??
                              "Ukjent"
                            }
                            variant={billingStatusVariant(company.billing_status)}
                          />
                        </div>
                      </TableCell>
                      <TableCell>{company.employee_count}</TableCell>
                      <TableCell>{formatDate(company.created_at)}</TableCell>
                      <TableCell>
                        <StatusBadge
                          label={sellerContactStatusLabels[company.contact_status]}
                          variant={
                            company.contact_status === "kunde"
                              ? "success"
                              : company.contact_status === "ukontaktet"
                                ? "muted"
                                : "default"
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-8"
                            disabled={!company.phone}
                            onClick={(event) => handlePhoneClick(event, company)}
                            aria-label="Ring"
                          >
                            <PhoneIcon className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            className="size-8"
                            disabled={!company.email}
                            onClick={(event) => handleEmailClick(event, company)}
                            aria-label="E-post"
                          >
                            <MailIcon className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </SelgerPageShell>
  )
}
