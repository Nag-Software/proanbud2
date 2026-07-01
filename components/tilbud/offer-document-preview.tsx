"use client"

import { Fragment, useMemo } from "react"

import {
  buildOfferDocumentModel,
  buildOfferFooterParts,
  calculateGroupTotal,
  formatDocumentAmount,
  formatDocumentCurrency,
  formatDocumentQuantity,
  formatDocumentUnit,
  formatOfferDate,
  formatOfferDateTime,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import {
  calculateLineItemTotal,
  calculateLineItemUnitPriceWithMarkupBeforeDiscount,
} from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"

type OfferDocumentPreviewProps = OfferDocumentData & {
  className?: string
  documentClassName?: string
  showSupplier?: boolean
}

function PartyLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-[5px] text-[9.5px] font-bold uppercase tracking-[0.1em] text-gray-400">{children}</p>
  )
}

function PartyLine({ value, strong }: { value?: string | null; strong?: boolean }) {
  if (!value) return null
  return (
    <p
      className={
        strong
          ? "mb-0.5 text-[12px] font-semibold leading-[1.5] text-gray-900"
          : "mb-0.5 text-[11px] leading-[1.5] text-gray-600"
      }
    >
      {value}
    </p>
  )
}

export function OfferDocumentPreview({
  className,
  documentClassName,
  showSupplier = true,
  ...data
}: OfferDocumentPreviewProps) {
  const m = useMemo(() => buildOfferDocumentModel(data), [data])
  const company = data.company

  const showDiscountColumn = useMemo(
    () => data.lineItems.some((item) => item.discountPercent > 0),
    [data.lineItems]
  )
  const columnCount = showDiscountColumn ? 7 : 6

  const logoSrc = company?.logoUrl || null

  const termsItems = useMemo(() => {
    const items: string[] = []
    if (m.validUntil) {
      items.push(
        `Tilbudet er gyldig til ${formatOfferDate(m.validUntil)} (${m.validityDays} dager fra utstedelsesdato).`
      )
    } else {
      items.push(`Tilbudet er gyldig i ${m.validityDays} dager fra utstedelsesdato.`)
    }
    if (m.pricingModelLabel) items.push(`Prismodell: ${m.pricingModelLabel}.`)
    if (m.contractBasisLabel) items.push(`Kontraktsgrunnlag: ${m.contractBasisLabel}.`)
    items.push("Alle priser er oppgitt i norske kroner. Merverdiavgift (25 %) er spesifisert.")
    return items
  }, [m.validUntil, m.validityDays, m.pricingModelLabel, m.contractBasisLabel])

  const footerParts = buildOfferFooterParts(company)

  // Continuous position numbers across groups, precomputed so render stays pure.
  const numberedGroups = useMemo(() => {
    let position = 0
    return m.groupEntries.map(([groupName, items]) => ({
      groupName,
      items: items.map((item) => ({ item, position: ++position })),
    }))
  }, [m.groupEntries])

  return (
    <div className={className || "bg-[#e8e6e1] p-4 sm:p-6"}>
      <div
        className={cn(
          "flex flex-col",
          documentClassName ||
            "mx-auto w-full min-w-0 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)] sm:min-w-[794px]"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-6 px-12 pb-5 pt-[34px]">
          <div className="flex min-w-0 items-center gap-3.5">
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoSrc}
                alt=""
                className="h-[46px] max-w-[170px] object-contain object-left"
              />
            ) : null}
            <p
              className={cn(
                "font-bold leading-tight tracking-[-0.01em] text-gray-900",
                logoSrc ? "text-[16px]" : "text-[20px]"
              )}
            >
              {m.companyName}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[26px] font-extrabold leading-none tracking-[0.02em] text-gray-900">TILBUD</p>
            {data.offerReference ? (
              <p className="mt-[7px] text-[11.5px] font-semibold text-gray-900">Tilbudsnr. {data.offerReference}</p>
            ) : null}
            <p className={cn("text-[11px] text-gray-500", data.offerReference ? "mt-0.5" : "mt-[7px]")}>
              Dato: {formatOfferDate(m.issuedDate)}
            </p>
            {m.validUntil ? (
              <p className="mt-0.5 text-[11px] text-gray-500">Gyldig til: {formatOfferDate(m.validUntil)}</p>
            ) : null}
          </div>
        </div>

        <div className="mx-12 border-t border-gray-300" />

        {/* Parties */}
        <div className="grid grid-cols-2 gap-8 px-12 pt-4">
          <div>
            <PartyLabel>Fra</PartyLabel>
            <PartyLine value={m.companyName} strong />
            <PartyLine value={company?.address} />
            <PartyLine value={m.companyAddressLine} />
            <PartyLine value={company?.orgNumber ? `Org.nr. ${company.orgNumber}` : null} />
            <PartyLine value={company?.phone ? `Tlf. ${company.phone}` : null} />
            <PartyLine value={company?.email} />
            <PartyLine value={company?.website} />
          </div>
          <div>
            <PartyLabel>Tilbud til</PartyLabel>
            <PartyLine value={m.customerName} strong />
            <PartyLine value={data.customer.address} />
            <PartyLine value={m.customerAddressLine} />
            <PartyLine value={data.customer.orgNumber ? `Org.nr. ${data.customer.orgNumber}` : null} />
            <PartyLine value={data.customer.phone ? `Tlf. ${data.customer.phone}` : null} />
            <PartyLine value={data.customer.email} />
          </div>
        </div>

        {/* Title + intro */}
        <div className="px-12 pb-1 pt-[18px]">
          <h1 className="text-[16px] font-bold tracking-[-0.01em] text-gray-900">{m.title}</h1>
          {data.projectName ? (
            <p className="mt-[3px] text-[11px] text-gray-500">Prosjekt: {data.projectName}</p>
          ) : null}
          {m.introText ? (
            <p className="mt-2.5 whitespace-pre-line break-words text-[11.5px] leading-[1.6] text-gray-700">
              {m.introText}
            </p>
          ) : null}
          {m.quoteMessage ? (
            <p className="mt-2.5 whitespace-pre-line break-words border-l-2 border-gray-300 pl-2.5 text-[11.5px] italic leading-[1.6] text-gray-500">
              {m.quoteMessage}
            </p>
          ) : null}
        </div>

        {/* Line items */}
        <div className="px-12 pt-3.5">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-900">
                <th className="w-[26px] pb-[7px] text-left text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">#</th>
                <th className="pb-[7px] text-left text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">Beskrivelse</th>
                <th className="w-[52px] pb-[7px] text-right text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">Antall</th>
                <th className="w-[46px] pb-[7px] text-right text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">Enhet</th>
                <th className="w-[76px] pb-[7px] text-right text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">À-pris</th>
                {showDiscountColumn ? (
                  <th className="w-[52px] pb-[7px] text-right text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">Rabatt</th>
                ) : null}
                <th className="w-[86px] pb-[7px] pl-3.5 text-right text-[9.5px] font-bold uppercase tracking-[0.08em] text-gray-500">Beløp</th>
              </tr>
            </thead>
            <tbody>
              {m.groupEntries.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="py-6 text-center text-[11.5px] text-gray-500">
                    Ingen linjer i tilbudet.
                  </td>
                </tr>
              ) : null}
              {numberedGroups.map(({ groupName, items }) => (
                <Fragment key={groupName}>
                  {m.showGroups ? (
                    <tr>
                      <td
                        colSpan={columnCount - 1}
                        className="border-b border-gray-200 pb-1 pt-3.5 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-900"
                      >
                        {groupName}
                      </td>
                      <td className="whitespace-nowrap border-b border-gray-200 pb-1 pl-3.5 pt-3.5 text-right text-[10px] font-semibold tabular-nums text-gray-400">
                        {formatDocumentAmount(calculateGroupTotal(items.map(({ item }) => item)))}
                      </td>
                    </tr>
                  ) : null}
                  {items.map(({ item, position }) => {
                    return (
                      <tr key={item.id}>
                        <td className="border-b border-gray-100 py-[7px] align-top text-[11px] text-gray-400">
                          {position}
                        </td>
                        <td className="border-b border-gray-100 py-[7px] align-top text-[11px]">
                          <span className="font-semibold text-gray-900">{item.title}</span>
                          {item.description ? (
                            <span className="mt-px block whitespace-pre-line break-words text-[10px] font-normal leading-[1.45] text-gray-500">
                              {item.description}
                            </span>
                          ) : null}
                          {showSupplier && item.supplier ? (
                            <span className="mt-px block text-[9.5px] font-normal text-gray-400">{item.supplier}</span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap border-b border-gray-100 py-[7px] text-right align-top text-[11px] tabular-nums text-gray-700">
                          {formatDocumentQuantity(item.quantity)}
                        </td>
                        <td className="border-b border-gray-100 py-[7px] text-right align-top text-[11px] text-gray-500">
                          {formatDocumentUnit(item.unit)}
                        </td>
                        <td className="whitespace-nowrap border-b border-gray-100 py-[7px] text-right align-top text-[11px] tabular-nums text-gray-700">
                          {formatDocumentAmount(calculateLineItemUnitPriceWithMarkupBeforeDiscount(item))}
                        </td>
                        {showDiscountColumn ? (
                          <td className="whitespace-nowrap border-b border-gray-100 py-[7px] text-right align-top text-[11px] tabular-nums text-gray-500">
                            {item.discountPercent > 0 ? `${formatDocumentQuantity(item.discountPercent)} %` : "–"}
                          </td>
                        ) : null}
                        <td className="whitespace-nowrap border-b border-gray-100 py-[7px] pl-3.5 text-right align-top text-[11px] font-semibold tabular-nums text-gray-900">
                          {formatDocumentAmount(calculateLineItemTotal(item))}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mx-12 border-t border-gray-900" />

        {/* Totals */}
        <div className="flex justify-end px-12 pt-3.5">
          <div className="w-[270px]">
            <div className="flex justify-between gap-4 py-[3px]">
              <span className="text-[11.5px] text-gray-600">Sum eks. mva</span>
              <span className="whitespace-nowrap text-[11.5px] tabular-nums text-gray-900">
                {formatDocumentCurrency(m.preDiscountSubtotalNok)}
              </span>
            </div>
            {m.hasDiscount ? (
              <>
                <div className="flex justify-between gap-4 py-[3px]">
                  <span className="text-[11.5px] text-gray-600">Rabatt</span>
                  <span className="whitespace-nowrap text-[11.5px] tabular-nums text-gray-900">
                    − {formatDocumentCurrency(m.totals.discountNok)}
                  </span>
                </div>
                <div className="flex justify-between gap-4 py-[3px]">
                  <span className="text-[11.5px] text-gray-600">Nettosum eks. mva</span>
                  <span className="whitespace-nowrap text-[11.5px] tabular-nums text-gray-900">
                    {formatDocumentCurrency(m.totals.subtotalNok)}
                  </span>
                </div>
              </>
            ) : null}
            <div className="flex justify-between gap-4 py-[3px]">
              <span className="text-[11.5px] text-gray-500">Mva (25 %)</span>
              <span className="whitespace-nowrap text-[11.5px] tabular-nums text-gray-900">
                {formatDocumentCurrency(m.vatAmountNok)}
              </span>
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-gray-900 pt-[7px]">
              <span className="text-[12px] font-bold text-gray-900">Totalt inkl. mva</span>
              <span className="whitespace-nowrap text-[14px] font-bold tabular-nums text-gray-900">
                {formatDocumentCurrency(m.totalInclVatNok)}
              </span>
            </div>
          </div>
        </div>

        {/* Payment schedule */}
        {m.paymentSchedule.length ? (
          <div className="px-12 pt-[22px]">
            <PartyLabel>Betalingsplan</PartyLabel>
            <div className="border-t border-gray-200">
              {m.paymentSchedule.map((entry, index) => (
                <div
                  key={`${entry.label}-${index}`}
                  className="flex justify-between gap-4 border-b border-gray-100 py-1.5"
                >
                  <span className="text-[11px] text-gray-700">
                    {entry.label}
                    {entry.dueDescription ? <span className="text-gray-400"> — {entry.dueDescription}</span> : null}
                  </span>
                  <span className="whitespace-nowrap text-[11px] tabular-nums text-gray-900">
                    {formatDocumentQuantity(entry.percent)} % · {formatDocumentCurrency(Math.round(m.totalInclVatNok * entry.percent) / 100)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Terms */}
        <div className="px-12 pt-[22px]">
          <PartyLabel>Forutsetninger og vilkår</PartyLabel>
          <ul className="list-disc pl-4">
            {termsItems.map((item) => (
              <li key={item} className="text-[10.5px] leading-[1.7] text-gray-600">
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Acceptance */}
        <div className="px-12 pb-2 pt-[22px]">
          <PartyLabel>Aksept av tilbud</PartyLabel>
          {data.acceptance ? (
            <div className="rounded-md border border-gray-200 bg-[#fafafa] px-3.5 py-3">
              <p className="mb-2 text-[10.5px] font-semibold text-gray-900">
                Tilbudet er akseptert digitalt {formatOfferDateTime(data.acceptance.acceptedAt)}. Aksepten utgjør en
                bindende avtale om leveransen beskrevet i dette dokumentet.
              </p>
              <div className="flex gap-3 py-[3px]">
                <span className="w-[150px] shrink-0 text-[10px] text-gray-500">Akseptert av</span>
                <span className="break-all text-[10px] font-semibold text-gray-900">{data.acceptance.name}</span>
              </div>
              <div className="flex gap-3 py-[3px]">
                <span className="w-[150px] shrink-0 text-[10px] text-gray-500">Bekreftet via engangskode til</span>
                <span className="break-all text-[10px] font-semibold text-gray-900">{data.acceptance.email}</span>
              </div>
              <div className="flex gap-3 py-[3px]">
                <span className="w-[150px] shrink-0 text-[10px] text-gray-500">Dokument-ID (SHA-256)</span>
                <span className="break-all text-[10px] font-semibold text-gray-900">
                  {data.acceptance.documentSha256}
                </span>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[10.5px] leading-[1.6] text-gray-600">
                Tilbudet aksepteres via tilbudslenken dere har mottatt, eller ved signering nedenfor. Aksept utgjør en
                bindende avtale om leveransen beskrevet i dette tilbudet.
              </p>
              <div className="mt-[30px] flex gap-10">
                <div className="flex-1 border-t border-gray-400 pt-[5px] text-[10px] text-gray-500">Sted / dato</div>
                <div className="flex-1 border-t border-gray-400 pt-[5px] text-[10px] text-gray-500">
                  Signatur {m.customerName}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="mt-auto pt-7">
          <div className="border-t border-gray-200 px-12 pb-5 pt-3">
            <p className="text-center text-[9.5px] tracking-[0.02em] text-gray-400">
              {footerParts.join("  ·  ")}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
