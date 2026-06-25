"use client"

import { Fragment, useMemo } from "react"

import {
  computeValidityDays,
  formatOfferDate,
  getOfferDocumentTotals,
  groupLineItemsBySubproject,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { calculateLineItemTotal, calculateLineItemUnitPriceWithMarkup, formatNok } from "@/lib/tilbud/types"

type OfferDocumentPreviewProps = OfferDocumentData & {
  className?: string
  documentClassName?: string
  showSupplier?: boolean
}

export function OfferDocumentPreview({
  title,
  description,
  projectSummary,
  quoteMessage,
  projectName,
  customer,
  lineItems,
  company,
  issuedDate,
  validityDays,
  quoteValidUntil,
  className,
  documentClassName,
  showSupplier = true,
}: OfferDocumentPreviewProps) {
  const groupedPreview = useMemo(() => groupLineItemsBySubproject(lineItems), [lineItems])
  const resolvedValidityDays = validityDays ?? computeValidityDays(String(issuedDate || ""), quoteValidUntil)
  const { totals, vatAmountNok, totalInclVatNok } = useMemo(() => getOfferDocumentTotals(lineItems), [lineItems])

  return (
    <div className={className || "bg-[#e8e6e1] p-4 sm:p-6"}>
      <div
        className={
          documentClassName ||
          "mx-auto w-full min-w-0 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)] sm:min-w-[794px]"
        }
      >
        <div className="flex items-start justify-between gap-6 border-b border-gray-200 px-8 py-6">
          <div className="flex items-center gap-3">
            {company?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logoUrl} alt="Logo" className="h-10 w-10 object-contain" />
            ) : (
              <img src="/favicon.ico" alt="Logo" className="h-10 w-10 object-contain" />
            )}
            <div>
              <p className="text-[15px] font-bold leading-tight text-gray-950">{company?.name || "Proanbud"}</p>
              {company?.orgNumber ? <p className="text-[11px] text-gray-500">Org.nr. {company.orgNumber}</p> : null}
              {company?.email || company?.phone ? (
                <p className="text-[11px] text-gray-500">
                  {[company.email, company.phone].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[22px] font-bold tracking-tight text-gray-950">TILBUD</p>
            <p className="mt-0.5 text-[12px] text-gray-500">{title.trim() || "Tilbud"}</p>
            <p className="text-[12px] text-gray-500">Dato: {formatOfferDate(issuedDate || new Date())}</p>
            <p className="text-[12px] text-gray-500">Gyldighet: {resolvedValidityDays} dager</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 border-b border-gray-200 px-8 py-4 text-[12px]">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Kunde</p>
            <p className="font-semibold text-gray-900">{customer.name || "—"}</p>
            {customer.address || customer.city ? (
              <p className="text-gray-600">{[customer.address, customer.city].filter(Boolean).join(", ")}</p>
            ) : null}
            {customer.email ? <p className="text-gray-600">{customer.email}</p> : null}
            {customer.phone ? <p className="text-gray-600">{customer.phone}</p> : null}
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Prosjekt</p>
            <p className="font-semibold text-gray-900">{projectName || "—"}</p>
            {(projectSummary?.trim() || description?.trim()) ? (
              <p className="mt-1 whitespace-pre-line break-words text-gray-600">
                {projectSummary?.trim() || description?.trim() || ""}
              </p>
            ) : null}
            {quoteMessage?.trim() ? (
              <p className="mt-2 whitespace-pre-line break-words italic leading-5 text-gray-500">
                &quot;{quoteMessage.trim()}&quot;
              </p>
            ) : null}
          </div>
        </div>

        <div className="px-8 py-4">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b-2 border-gray-900 text-left">
                <th className="pb-1.5 pr-3 font-semibold uppercase tracking-widest text-gray-500">Beskrivelse</th>
                <th className="pb-1.5 pr-3 text-right font-semibold uppercase tracking-widest text-gray-500">Antall</th>
                <th className="pb-1.5 pr-3 text-right font-semibold uppercase tracking-widest text-gray-500">Enhet</th>
                <th className="pb-1.5 pr-3 text-right font-semibold uppercase tracking-widest text-gray-500">Enhetspris</th>
                <th className="pb-1.5 text-right font-semibold uppercase tracking-widest text-gray-500">Rabatt</th>
                <th className="pb-1.5 pl-4 text-right font-semibold uppercase tracking-widest text-gray-500">Beløp</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(groupedPreview).map(([groupName, items]) => (
                <Fragment key={groupName}>
                  <tr>
                    <td colSpan={6} className="border-b border-gray-200 pb-1 pt-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{groupName}</span>
                    </td>
                  </tr>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b border-gray-100">
                      <td className="py-1.5 pr-3 font-medium text-gray-900">
                        {item.title}
                        {item.description ? (
                          <span className="block whitespace-pre-line break-words text-[10px] font-normal leading-[1.4] text-gray-500">
                            {item.description}
                          </span>
                        ) : null}
                        {showSupplier && item.supplier ? (
                          <span className="block text-[10px] font-normal text-gray-400">{item.supplier}</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{item.quantity}</td>
                      <td className="py-1.5 pr-3 text-right text-gray-500">{item.unit}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{formatNok(calculateLineItemUnitPriceWithMarkup(item))}</td>
                      <td className="py-1.5 text-right text-gray-500">{item.discountPercent > 0 ? `${item.discountPercent}%` : "—"}</td>
                      <td className="py-1.5 pl-4 text-right tabular-nums font-semibold text-gray-900">
                        {formatNok(calculateLineItemTotal(item))}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t-2 border-gray-900 px-8 py-4">
          <div className="ml-auto w-56 text-[12px]">
            <div className="flex justify-between py-0.5">
              <span className="text-gray-600">Subtotal eks. mva</span>
              <span className="font-medium tabular-nums text-gray-900">{formatNok(totals.subtotalNok)}</span>
            </div>
            {totals.discountNok > 0 ? (
              <div className="flex justify-between py-0.5">
                <span className="text-gray-600">Rabatt</span>
                <span className="font-medium tabular-nums text-gray-900">- {formatNok(totals.discountNok)}</span>
              </div>
            ) : null}
            <div className="flex justify-between border-t border-dashed border-gray-300 py-1">
              <span className="text-gray-600">Grunnlag mva (25%)</span>
              <span className="tabular-nums text-gray-700">{formatNok(totals.subtotalNok)}</span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-gray-600">Mva 25%</span>
              <span className="tabular-nums text-gray-700">{formatNok(vatAmountNok)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t-2 border-gray-900 pt-1.5">
              <span className="font-bold text-gray-950">Totalt inkl. mva</span>
              <span className="font-bold tabular-nums text-gray-950">{formatNok(totalInclVatNok)}</span>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-8 py-3 text-[10px] text-gray-400">
          <p>Dette tilbudet er gyldig i {resolvedValidityDays} dager fra utstedelsesdato. Alle priser er oppgitt i NOK.</p>
        </div>
      </div>
    </div>
  )
}
