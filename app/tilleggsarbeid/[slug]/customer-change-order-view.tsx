"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"

import { reportClientError } from "@/lib/errors/client"
import type { PublicChangeOrder } from "@/lib/tilleggsarbeid/change-order"

function formatNok(value: number) {
  return new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(value)
}

export function CustomerChangeOrderView({ co, slug }: { co: PublicChangeOrder; slug: string }) {
  const [done, setDone] = useState<"accepted" | "rejected" | null>(
    co.status === "accepted" ? "accepted" : co.status === "rejected" ? "rejected" : null,
  )
  const [submitting, setSubmitting] = useState<"accept" | "reject" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function respond(action: "accept" | "reject") {
    setSubmitting(action)
    setError(null)
    try {
      const res = await fetch(`/api/public/tilleggsarbeid/${slug}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok && !data.alreadyResponded) throw new Error(data.error || "Noe gikk galt")
      setDone(action === "accept" ? "accepted" : "rejected")
    } catch (e) {
      reportClientError(e, { context: { action: "respond to change order", slug, response: action } })
      setError(e instanceof Error ? e.message : "Noe gikk galt")
    } finally {
      setSubmitting(null)
    }
  }

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

          <div className="mt-6 rounded-xl bg-neutral-50 px-4 py-4 text-center">
            <p className="text-xs text-neutral-500">Pris (eks. mva)</p>
            <p className="mt-1 text-3xl font-semibold text-neutral-900">{formatNok(co.amountNok)}</p>
          </div>

          {done === "accepted" ? (
            <div className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-emerald-50 px-4 py-4 text-emerald-700">
              <Check className="h-5 w-5" />
              <span className="font-medium">Du har godkjent tilleggsarbeidet</span>
            </div>
          ) : done === "rejected" ? (
            <div className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-neutral-100 px-4 py-4 text-neutral-600">
              <X className="h-5 w-5" />
              <span className="font-medium">Du har avslått tilleggsarbeidet</span>
            </div>
          ) : (
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => respond("accept")}
                disabled={submitting !== null}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-base font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
              >
                <Check className="h-5 w-5" />
                {submitting === "accept" ? "Godkjenner …" : "Godkjenn"}
              </button>
              <button
                type="button"
                onClick={() => respond("reject")}
                disabled={submitting !== null}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-neutral-200 text-sm font-medium text-neutral-600 transition active:scale-[0.99] disabled:opacity-60"
              >
                {submitting === "reject" ? "Avslår …" : "Avslå"}
              </button>
              {error ? <p className="text-center text-sm text-red-600">{error}</p> : null}
            </div>
          )}
        </div>
      </div>
      <p className="mt-6 text-xs text-neutral-400">Sendt via Proanbud</p>
    </div>
  )
}
