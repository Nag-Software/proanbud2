"use client"

import * as React from "react"
import { Customer } from "./schema"
import { CustomerRowActions } from "./columns"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Building2, Mail, Phone, Search, User, Users } from "lucide-react"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 10

type TypeFilter = "alle" | "privatperson" | "bedrift"

// Soft, friendly initial-avatar tones (light bg + dark text from the same family).
// Picked deterministically per customer so the same person always gets the same colour.
const AVATAR_TONES = [
  { bg: "#E1F5EE", fg: "#085041" },
  { bg: "#E6F1FB", fg: "#0C447C" },
  { bg: "#EEEDFE", fg: "#3C3489" },
  { bg: "#FAEEDA", fg: "#633806" },
  { bg: "#EAF3DE", fg: "#27500A" },
  { bg: "#FBEAF0", fg: "#72243E" },
] as const

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function getTone(name: string): (typeof AVATAR_TONES)[number] {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length]
}

interface CustomerListProps {
  data: Customer[]
  onRowClick: (customer: Customer) => void
  /** Show a small Tripletex sync chip per row. Only when Tripletex is connected. */
  tripletexEnabled?: boolean
}

export function CustomerList({ data, onRowClick, tripletexEnabled = false }: CustomerListProps) {
  const [query, setQuery] = React.useState("")
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("alle")
  const [page, setPage] = React.useState(0)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return data.filter((customer) => {
      if (typeFilter !== "alle" && customer.type !== typeFilter) return false
      if (!q) return true
      return (
        customer.name.toLowerCase().includes(q) ||
        customer.email.toLowerCase().includes(q) ||
        customer.phone.toLowerCase().includes(q)
      )
    })
  }, [data, query, typeFilter])

  // Reset to the first page whenever the filters narrow the result set.
  React.useEffect(() => {
    setPage(0)
  }, [query, typeFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE)

  const filters: ReadonlyArray<readonly [TypeFilter, string]> = [
    ["alle", "Alle"],
    ["privatperson", "Privatperson"],
    ["bedrift", "Bedrift"],
  ]

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Søk på navn, telefon eller e-post …"
          aria-label="Søk i kunder"
          className="pl-9"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-md bg-secondary p-0.5 text-sm">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              aria-pressed={typeFilter === value}
              className={cn(
                "cursor-pointer rounded-[4px] px-3 py-2.5 font-medium transition-colors sm:py-1.5",
                typeFilter === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-sm whitespace-nowrap text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "kunde" : "kunder"}
        </span>
      </div>

      {pageRows.length > 0 ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {pageRows.map((customer) => (
            <CustomerRow
              key={customer.id}
              customer={customer}
              onRowClick={onRowClick}
              tripletexEnabled={tripletexEnabled}
            />
          ))}
        </div>
      ) : (
        <EmptyState hasCustomers={data.length > 0} query={query.trim()} />
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            Forrige
          </Button>
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            Side {currentPage + 1} av {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={currentPage >= pageCount - 1}
          >
            Neste
          </Button>
        </div>
      )}
    </div>
  )
}

function CustomerRow({
  customer,
  onRowClick,
  tripletexEnabled,
}: {
  customer: Customer
  onRowClick: (customer: Customer) => void
  tripletexEnabled: boolean
}) {
  const isBusiness = customer.type === "bedrift"
  const tone = getTone(customer.name)
  const contactLine = [customer.email, customer.phone].filter(Boolean).join(" · ") || "Ingen kontaktinfo"

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-prevent-row-click]")) return
        onRowClick(customer)
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onRowClick(customer)
        }
      }}
      className="flex cursor-pointer items-center gap-3 px-3 py-3 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50 active:bg-muted sm:px-4"
    >
      <Avatar size="lg">
        <AvatarFallback
          style={{ backgroundColor: tone.bg, color: tone.fg }}
          className="font-medium"
        >
          {getInitials(customer.name)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{customer.name}</span>
          <Badge
            variant={isBusiness ? "default" : "secondary"}
            className="hidden shrink-0 sm:inline-flex"
          >
            {isBusiness ? "Bedrift" : "Privat"}
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {isBusiness ? (
            <Building2 className="size-3 shrink-0" />
          ) : (
            <User className="size-3 shrink-0" />
          )}
          <span className="truncate">{contactLine}</span>
        </div>
      </div>

      {tripletexEnabled && customer.syncStatus && customer.syncStatus !== "none" && (
        <span className="hidden lg:inline-flex">
          <TripletexBadge status={customer.syncStatus} />
        </span>
      )}

      <span className="hidden shrink-0 text-xs whitespace-nowrap text-muted-foreground sm:inline">
        {customer.activeProjects > 0
          ? `${customer.activeProjects} ${customer.activeProjects === 1 ? "prosjekt" : "prosjekter"}`
          : "Ingen prosjekt"}
      </span>

      <div
        className="flex items-center gap-1"
        data-prevent-row-click
        onClick={(event) => event.stopPropagation()}
      >
        <ContactButton
          href={customer.phone ? `tel:${customer.phone.replace(/\s+/g, "")}` : null}
          label={`Ring ${customer.name}`}
          icon={<Phone className="size-4" />}
        />
        <ContactButton
          href={customer.email ? `mailto:${customer.email}` : null}
          label={`Send e-post til ${customer.name}`}
          icon={<Mail className="size-4" />}
          className="hidden sm:inline-flex"
        />
        <CustomerRowActions customer={customer} onViewDetails={onRowClick} />
      </div>
    </div>
  )
}

function ContactButton({
  href,
  label,
  icon,
  className,
}: {
  href: string | null
  label: string
  icon: React.ReactNode
  className?: string
}) {
  if (!href) {
    return (
      <Button
        variant="outline"
        size="icon"
        disabled
        aria-label={`${label} (mangler)`}
        className={cn("text-muted-foreground", className)}
      >
        {icon}
      </Button>
    )
  }

  return (
    <Button asChild variant="outline" size="icon" aria-label={label} className={className}>
      <a href={href} onClick={(event) => event.stopPropagation()}>
        {icon}
      </a>
    </Button>
  )
}

function TripletexBadge({ status }: { status: NonNullable<Customer["syncStatus"]> }) {
  if (status === "synced") return <Badge variant="outline">Synkronisert</Badge>
  if (status === "syncing") return <Badge variant="secondary">Synker …</Badge>
  if (status === "attention") return <Badge variant="destructive">Krever handling</Badge>
  return null
}

function EmptyState({ hasCustomers, query }: { hasCustomers: boolean; query: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Users className="size-5" />
      </div>
      <p className="font-medium">{hasCustomers ? "Ingen treff" : "Ingen kunder enda"}</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        {hasCustomers
          ? query
            ? `Fant ingen kunder som matcher «${query}».`
            : "Ingen kunder i dette filteret."
          : "Legg til din første kunde med «Ny kunde»-knappen øverst."}
      </p>
    </div>
  )
}
