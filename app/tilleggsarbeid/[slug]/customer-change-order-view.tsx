"use client"

import { AlertTriangle } from "lucide-react"

import type { PublicChangeOrder } from "@/lib/tilleggsarbeid/change-order"

function formatNok(value: number) {
  return new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(value)
}

export function CustomerChangeOrderView({ co, slug }: { co: PublicChangeOrder; slug: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-100 px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 px-6 py-5">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Tilleggsarbeid</p>
          <p className="mt-0.5 text-sm text-neutral-500">{co.companyName}</p>
        </div>

        <div className="px-6 py-6">
          <h1 className="text-lg font-semibold text-neutral-900">{co.title}</h1>
          {co.description ? <p className="mt-2 text-sm leading-relaxed text-neutral-600">{co.description}</p> : null}

          <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
              {co.billingType === "hourly" ? "Per time" : "Fastpris"}
            </span>
            {co.billingType === "hourly" && co.hourlyRateNok !== null && co.estimatedHours !== null ? (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-600">
                {co.estimatedHours} t x {formatNok(co.hourlyRateNok)}/t
              </span>
            ) : null}
          </div>

          <div className="mt-6 rounded-xl bg-neutral-50 px-4 py-4 text-center">
            <p className="text-xs text-neutral-500">Pris (eks. mva)</p>
            <p className="mt-1 text-3xl font-semibold text-neutral-900">{formatNok(co.amountNok)}</p>
          </div>

          <div className="mt-6 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-4 text-amber-800">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium">Dette er en varsling, ikke en godkjenningsside</p>
              <p className="mt-1 text-sm leading-relaxed text-amber-700">
                Ekstrajobben er registrert av bedriften og brukes internt for oppfølging og fakturering.
              </p>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-6 text-xs text-neutral-400">Varsel via Proanbud</p>
    </div>
  )
}
