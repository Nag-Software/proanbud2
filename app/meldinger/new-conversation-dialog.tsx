"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Search } from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { messageableOffers, type InboxCustomer, type InboxOffer } from "@/lib/meldinger/inbox"
import { initials } from "./conversation-list"

/**
 * Velg kunden du vil skrive til. Bare kunder med et sendt tilbud kan velges:
 * kunden leser meldinger på tilbudssiden, så uten tilbud når meldingen ingen.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  customers,
  offers,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: InboxCustomer[]
  offers: InboxOffer[]
  onPick: (customerId: string) => void
}) {
  const [query, setQuery] = useState("")

  const candidates = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("nb")
    return customers
      .map((customer) => ({ customer, offer: messageableOffers(offers, customer.id)[0] ?? null }))
      .filter((c): c is { customer: InboxCustomer; offer: InboxOffer } => c.offer !== null)
      .filter(
        ({ customer, offer }) =>
          !q ||
          customer.name.toLocaleLowerCase("nb").includes(q) ||
          offer.title.toLocaleLowerCase("nb").includes(q)
      )
      .sort((a, b) => a.customer.name.localeCompare(b.customer.name, "nb"))
  }, [customers, offers, query])

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("")
        onOpenChange(next)
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Ny melding</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Velg kunden. Meldingen vises på tilbudet deres, og de får varsel på e-post.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="px-4 pb-4 sm:px-0 sm:pb-0">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              type="search"
              aria-label="Søk etter kunde"
              placeholder="Søk kunde eller tilbud"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-8 [@media(pointer:coarse)]:min-h-11"
            />
          </div>
          <ul className="mt-2 max-h-[50vh] divide-y divide-border overflow-y-auto">
            {candidates.length === 0 ? (
              <li className="px-2 py-8 text-center text-xs text-muted-foreground">
                {query.trim() ? (
                  "Ingen kunder med sendt tilbud passer søket."
                ) : (
                  <>
                    Ingen kunder har fått et tilbud ennå.{" "}
                    <Link href="/nytt-tilbud" className="font-medium text-primary underline-offset-4 hover:underline">
                      Lag et tilbud
                    </Link>
                  </>
                )}
              </li>
            ) : (
              candidates.map(({ customer, offer }) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(customer.id)
                      setQuery("")
                    }}
                    className="flex min-h-12 w-full items-center gap-2.5 px-1 py-2 text-left hover:bg-muted"
                  >
                    <Avatar className="size-8 rounded-full">
                      <AvatarFallback className="rounded-full bg-primary/10 text-[11px] font-medium text-primary">
                        {initials(customer.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{customer.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{offer.title}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
