"use client"

import {
  buildOfferDocumentModel,
  formatDocumentAmount,
  formatDocumentCurrency,
  formatDocumentQuantity,
  formatDocumentUnit,
  formatOfferDate,
  formatOfferDateTime,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { cn } from "@/lib/utils"

/**
 * Tilbudet slik kunden leser det på telefonen: kort i stedet for et nedskalert
 * A4-ark. Bygger på samme dokumentmodell som PDF-en, så priser (inkl. mva for
 * privatkunder), summer og vilkår er identiske — bare oppsettet er annerledes.
 *
 * Brukes i kundens tilbudsvisning og i forhåndsvisningen på mobil, så
 * håndverkeren ser nøyaktig det kunden får.
 */
export function OfferMobileDocument({
  className,
  showSupplier = false,
  showIntro = true,
  ...data
}: OfferDocumentData & {
  className?: string
  showSupplier?: boolean
  /** Tittel, innledning og kundemelding. Av der siden viser dem selv (kundevisningen). */
  showIntro?: boolean
}) {
  const m = buildOfferDocumentModel(data)
  const { totals, vatAmountNok, vatRegistered, validityDays, validUntil } = m
  const company = data.company

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          {company?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
          ) : null}
          <div className="min-w-0">
            <p className="truncate font-semibold text-neutral-900">{m.companyName}</p>
            {company?.orgNumber ? <p className="text-xs text-neutral-500">Org.nr. {company.orgNumber}</p> : null}
          </div>
        </div>

        {showIntro ? (
          <>
            <h2 className="mt-4 text-base font-semibold leading-snug text-neutral-900">{m.title}</h2>
            {m.introText ? (
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-neutral-600">{m.introText}</p>
            ) : null}
            {m.quoteMessage ? (
              <p className="mt-2 whitespace-pre-line border-l-2 border-neutral-200 pl-3 text-sm italic leading-relaxed text-neutral-500">
                {m.quoteMessage}
              </p>
            ) : null}
          </>
        ) : null}

        <div className="mt-4 grid gap-3 text-sm">
          <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Kunde</p>
            <p className="mt-0.5 font-medium text-neutral-900">{m.customerName}</p>
            {data.customer.email ? <p className="text-xs text-neutral-500">{data.customer.email}</p> : null}
          </div>
          {data.projectName ? (
            <div className="rounded-xl bg-neutral-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Prosjekt</p>
              <p className="mt-0.5 font-medium text-neutral-900">{data.projectName}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
          {data.offerReference ? <span>Tilbudsnr. {data.offerReference}</span> : null}
          <span>Dato: {formatOfferDate(m.issuedDate)}</span>
          {validUntil ? <span>Gyldig til {formatOfferDate(validUntil)}</span> : <span>Gyldig {validityDays} dager</span>}
        </div>
      </div>

      {m.groupEntries.map(([groupName, items]) => (
        <div key={groupName} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          {m.showGroups ? (
            <div className="flex items-center justify-between gap-3 border-b border-neutral-100 bg-neutral-50 px-4 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{groupName}</p>
              <p className="text-[11px] font-medium tabular-nums text-neutral-400">
                {formatDocumentAmount(m.displayGroupTotal(items))}
              </p>
            </div>
          ) : null}
          <div className="divide-y divide-neutral-100">
            {items.map((item) => (
              <div key={item.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium leading-snug text-neutral-900">{item.title}</p>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900">
                    {formatDocumentAmount(m.displayLineTotal(item))}
                  </p>
                </div>
                {item.description ? (
                  <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-neutral-500">{item.description}</p>
                ) : null}
                <p className="mt-1.5 text-xs text-neutral-500">
                  {formatDocumentQuantity(item.quantity)} {formatDocumentUnit(item.unit)} ×{" "}
                  {formatDocumentAmount(m.displayUnitPrice(item))}
                  {item.discountPercent > 0 ? ` (−${formatDocumentQuantity(item.discountPercent)} %)` : ""}
                </p>
                {showSupplier && item.supplier ? (
                  <p className="mt-0.5 text-[11px] text-neutral-400">{item.supplier}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm shadow-sm">
        <div className="space-y-1.5">
          {m.pricesInclVat ? (
            <>
              {totals.discountNok > 0 ? (
                <>
                  <Row label="Sum før rabatt" value={formatDocumentCurrency(m.displayPreDiscountSubtotal)} />
                  <Row label="Rabatt" value={`− ${formatDocumentCurrency(m.displayDiscount)}`} />
                </>
              ) : null}
              <div className="flex items-baseline justify-between font-semibold text-neutral-900">
                <span>Totalt inkl. mva</span>
                <span className="text-base tabular-nums">{formatDocumentCurrency(m.totalInclVatNok)}</span>
              </div>
              <div className="flex justify-between text-xs text-neutral-500">
                <span>Herav mva (25 %)</span>
                <span className="tabular-nums">{formatDocumentCurrency(vatAmountNok)}</span>
              </div>
            </>
          ) : (
            <>
              <Row label="Sum eks. mva" value={formatDocumentCurrency(m.preDiscountSubtotalNok)} />
              {totals.discountNok > 0 ? (
                <>
                  <Row label="Rabatt" value={`− ${formatDocumentCurrency(totals.discountNok)}`} />
                  <Row label="Nettosum eks. mva" value={formatDocumentCurrency(totals.subtotalNok)} />
                </>
              ) : null}
              <Row
                label={`Mva${vatRegistered ? " (25 %)" : ""}`}
                value={vatRegistered ? formatDocumentCurrency(vatAmountNok) : "Ikke mva-pliktig"}
              />
              <div className="mt-1 flex items-baseline justify-between border-t border-neutral-900 pt-2 font-semibold text-neutral-900">
                <span>{vatRegistered ? "Totalt inkl. mva" : "Totalt"}</span>
                <span className="text-base tabular-nums">{formatDocumentCurrency(m.totalInclVatNok)}</span>
              </div>
            </>
          )}
        </div>
        <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-neutral-500">
          <li>
            {validUntil
              ? `Tilbudet er gyldig til ${formatOfferDate(validUntil)} (${validityDays} dager fra utstedelsesdato).`
              : `Tilbudet er gyldig i ${validityDays} dager fra utstedelsesdato.`}
          </li>
          {m.contractTerms.map((term) => (
            <li key={term}>{term}</li>
          ))}
          <li>{m.priceNote}</li>
        </ul>
      </div>

      {data.acceptance ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Aksept av tilbud</p>
          <p className="mt-1.5 text-[13px] font-medium leading-relaxed text-neutral-900">
            Akseptert digitalt {formatOfferDateTime(data.acceptance.acceptedAt)} av {data.acceptance.name}.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600">
            Bekreftet med engangskode til {data.acceptance.email}. Dokument-ID:{" "}
            <span className="break-all font-mono text-[10px]">{data.acceptance.documentSha256}</span>
          </p>
        </div>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-neutral-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
