"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PublicChangeOrder } from "@/lib/tilleggsarbeid/change-order"

function formatNok(value: number) {
  return new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(value)
}

function formatDateTime(value: string | null) {
  if (!value) return ""
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  }).format(new Date(value))
}

const VAT_RATE = 0.25

async function respond(slug: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/public/tilleggsarbeid/${slug}/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string; maskedEmail?: string }
  return { ok: response.ok, ...payload }
}

/**
 * Kundens side for tilleggsarbeid: se hva som er lagt til og hva det koster, og
 * godkjenn med navn og engangskode – eller avslå. Arbeidet skal ikke utføres før
 * kunden har svart.
 */
export function CustomerChangeOrderView({ co, slug }: { co: PublicChangeOrder; slug: string }) {
  const router = useRouter()
  const [step, setStep] = useState<"idle" | "code">("idle")
  const [maskedEmail, setMaskedEmail] = useState("")
  const [name, setName] = useState(co.customerName)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState<"code" | "accept" | "reject" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmReject, setConfirmReject] = useState(false)

  // Beløpene lagres eks. mva. Privatkunder skal se dem inkl. mva (prisopplysningsforskriften § 3).
  const vatFactor = co.pricesInclVat ? 1 + VAT_RATE : 1
  const amount = co.amountNok * vatFactor
  const hourlyRate = co.hourlyRateNok !== null ? co.hourlyRateNok * vatFactor : null

  async function requestCode() {
    setBusy("code")
    setError(null)
    const result = await respond(slug, { action: "request_code" })
    setBusy(null)
    if (!result.ok) {
      setError(result.error ?? "Kunne ikke sende kode. Prøv igjen.")
      return
    }
    setMaskedEmail(result.maskedEmail ?? "")
    setStep("code")
  }

  async function accept() {
    setBusy("accept")
    setError(null)
    const result = await respond(slug, { action: "accept", name: name.trim(), code: code.trim() })
    setBusy(null)
    if (!result.ok) {
      setError(result.error ?? "Kunne ikke godkjenne. Prøv igjen.")
      return
    }
    router.refresh()
  }

  async function reject() {
    setBusy("reject")
    setError(null)
    const result = await respond(slug, { action: "reject" })
    setBusy(null)
    if (!result.ok) {
      setError(result.error ?? "Kunne ikke lagre svaret. Prøv igjen.")
      return
    }
    router.refresh()
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-neutral-100 px-4 py-8 sm:justify-center sm:py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-100 px-6 py-5">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Tilleggsarbeid</p>
          <p className="mt-0.5 text-sm text-neutral-600">fra {co.companyName}</p>
        </div>

        <div className="px-6 py-6">
          <h1 className="text-lg font-semibold text-neutral-900">{co.title}</h1>
          {co.description ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-600">{co.description}</p>
          ) : null}

          <div className="mt-5 rounded-xl bg-neutral-50 px-4 py-4 text-center">
            <p className="text-xs text-neutral-500">{co.pricesInclVat ? "Pris inkl. mva" : "Pris eks. mva"}</p>
            <p className="mt-1 text-3xl font-semibold text-neutral-900">{formatNok(amount)}</p>
            {co.billingType === "hourly" && hourlyRate !== null && co.estimatedHours !== null ? (
              <p className="mt-1 text-xs text-neutral-500">
                Anslått {co.estimatedHours} timer à {formatNok(hourlyRate)}
              </p>
            ) : null}
            {co.pricesInclVat ? (
              <p className="mt-1 text-xs text-neutral-500">Herav mva {formatNok(amount - co.amountNok)}</p>
            ) : null}
          </div>

          {co.status === "accepted" ? (
            <div className="mt-6 flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-4 text-emerald-900">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-medium">Godkjent</p>
                <p className="mt-0.5 text-sm text-emerald-800">
                  {co.acceptedByName ? `Godkjent av ${co.acceptedByName}` : "Tilleggsarbeidet er avtalt"}
                  {co.respondedAt ? ` ${formatDateTime(co.respondedAt)}` : ""}. Du har fått en bekreftelse på e-post.
                </p>
              </div>
            </div>
          ) : co.status === "rejected" ? (
            <div className="mt-6 flex items-start gap-3 rounded-xl bg-neutral-100 px-4 py-4 text-neutral-800">
              <XCircle className="mt-0.5 size-5 shrink-0" />
              <div>
                <p className="font-medium">Avslått</p>
                <p className="mt-0.5 text-sm text-neutral-600">
                  Du har takket nei. {co.companyName} gjør ikke dette arbeidet uten ny avtale.
                </p>
              </div>
            </div>
          ) : co.canRespond ? (
            <div className="mt-6 space-y-4">
              <p className="text-sm leading-relaxed text-neutral-600">
                Arbeidet var ikke med i det opprinnelige tilbudet, og utføres ikke før du har godkjent det.
              </p>

              {step === "idle" ? (
                <Button className="h-12 w-full text-base" onClick={() => void requestCode()} disabled={busy !== null}>
                  {busy === "code" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                  Godkjenn tilleggsarbeidet
                </Button>
              ) : (
                <div className="space-y-3 rounded-xl border border-neutral-200 p-4">
                  <p className="text-sm text-neutral-600">
                    Vi har sendt en engangskode til <span className="font-medium text-neutral-900">{maskedEmail}</span>.
                  </p>
                  <div className="space-y-1.5">
                    <Label htmlFor="co-name">Fullt navn</Label>
                    <Input id="co-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="co-code">Engangskode</Label>
                    <Input
                      id="co-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="6 sifre"
                      value={code}
                      onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                    />
                  </div>
                  <Button
                    className="h-12 w-full text-base"
                    onClick={() => void accept()}
                    disabled={busy !== null || name.trim().length < 2 || code.length !== 6}
                  >
                    {busy === "accept" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Godkjenn med betalingsplikt
                  </Button>
                  <button
                    type="button"
                    className="w-full text-center text-sm text-neutral-500 underline-offset-4 hover:underline"
                    onClick={() => void requestCode()}
                    disabled={busy !== null}
                  >
                    Send ny kode
                  </button>
                </div>
              )}

              {confirmReject ? (
                <div className="flex gap-2">
                  <Button variant="outline" className="h-11 flex-1" onClick={() => setConfirmReject(false)} disabled={busy !== null}>
                    Avbryt
                  </Button>
                  <Button variant="destructive" className="h-11 flex-1" onClick={() => void reject()} disabled={busy !== null}>
                    {busy === "reject" ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Ja, avslå
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" className="h-11 w-full text-neutral-600" onClick={() => setConfirmReject(true)}>
                  Avslå
                </Button>
              )}

              {error ? (
                <p role="alert" className="text-center text-sm text-red-600">
                  {error}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-6 text-sm text-neutral-500">Tilleggsarbeidet er ikke klart for svar ennå.</p>
          )}
        </div>
      </div>
      <p className="mt-6 text-xs text-neutral-400">Sendt via Proanbud</p>
    </div>
  )
}
