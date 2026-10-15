"use client"

import Link from "next/link"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { ArrowUpRight, Mail, MapPin, Phone } from "lucide-react"

import { cn } from "@/lib/utils"
import type { InboxCustomer, InboxOffer, InboxProject } from "@/lib/meldinger/inbox"
import { OFFER_STATUS } from "./message-thread"

const nok = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 })
const shortDate = (iso: string) => format(new Date(iso), "d. MMM yyyy", { locale: nb })

/** Kunde, tilbudet samtalen gjelder, og prosjektet — det man ellers må lete etter. */
export function ConversationDetails({
  customer,
  offer,
  otherOffers,
  project,
}: {
  customer: InboxCustomer
  offer: InboxOffer | null
  otherOffers: InboxOffer[]
  project: InboxProject | null
}) {
  const address = [customer.address, [customer.postal_code, customer.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ")

  return (
    <div className="space-y-5 text-sm">
      <Section title="Kunde">
        <p className="font-medium">{customer.name}</p>
        <ul className="mt-1.5 space-y-0.5">
          {customer.phone && (
            <ContactLink href={`tel:${customer.phone.replace(/\s+/g, "")}`} icon={<Phone />} label={customer.phone} />
          )}
          {customer.email && <ContactLink href={`mailto:${customer.email}`} icon={<Mail />} label={customer.email} />}
          {address && (
            <li className="flex items-start gap-2 py-1 text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{address}</span>
            </li>
          )}
          {!customer.phone && !customer.email && !address && (
            <li className="text-xs text-muted-foreground">Ingen kontaktinfo lagret.</li>
          )}
        </ul>
      </Section>

      <Section title="Tilbud">
        {offer ? (
          <div>
            <p className="font-medium">{offer.title}</p>
            {offer.amount_nok != null && <p className="mt-0.5 tabular-nums">{nok.format(offer.amount_nok)}</p>}
            <dl className="mt-2 space-y-1 text-xs">
              <Row label="Status">
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className={cn("size-1.5 rounded-full", OFFER_STATUS[offer.status].dotClass)} />
                  {OFFER_STATUS[offer.status].label}
                </span>
              </Row>
              {offer.sent_at && <Row label="Sendt">{shortDate(offer.sent_at)}</Row>}
              {offer.customer_viewed_at && <Row label="Kunden åpnet">{shortDate(offer.customer_viewed_at)}</Row>}
              {offer.accepted_at && <Row label="Godkjent">{shortDate(offer.accepted_at)}</Row>}
            </dl>
            <InlineLink href={`/tilbud/${offer.id}`}>Åpne tilbudet</InlineLink>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Kunden har ikke fått et tilbud ennå.</p>
        )}
        {otherOffers.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">Andre tilbud til kunden</p>
            <ul className="mt-1">
              {otherOffers.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/tilbud/${o.id}`}
                    className="flex min-h-9 items-center gap-2 rounded-[5px] px-1 text-xs hover:bg-muted [@media(pointer:coarse)]:min-h-11"
                  >
                    <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", OFFER_STATUS[o.status].dotClass)} />
                    <span className="min-w-0 flex-1 truncate">{o.title}</span>
                    <span className="sr-only">, {OFFER_STATUS[o.status].label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      <Section title="Prosjekt">
        {project ? (
          <div>
            <p className="font-medium">{project.name}</p>
            <InlineLink href={`/prosjekter/${project.id}`}>Åpne prosjektet</InlineLink>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Ikke koblet til et prosjekt.</p>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function ContactLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <li>
      <a
        href={href}
        className="-mx-1 flex min-h-8 items-center gap-2 rounded-[5px] px-1 text-foreground hover:bg-muted [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground [@media(pointer:coarse)]:min-h-11"
      >
        {icon}
        <span className="min-w-0 truncate">{label}</span>
      </a>
    </li>
  )
}

function InlineLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-2 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline [@media(pointer:coarse)]:min-h-11"
    >
      {children}
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
    </Link>
  )
}
