"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Copy, Loader2, Plus, RefreshCw, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Textarea } from "@/components/ui/textarea"
import { reportClientError } from "@/lib/errors/client"
import { formatNok } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"
import type { ChangeOrder, ChangeOrderBillingType } from "@/lib/tilleggsarbeid/change-order"
import {
  describeChangeOrderStatus,
  MANUAL_APPROVAL_OPTIONS,
  type ChangeOrderApprovalBasis,
} from "@/lib/tilleggsarbeid/approval.shared"
import {
  createProjectChangeOrderAction,
  deleteProjectChangeOrderAction,
  listProjectChangeOrdersAction,
  markChangeOrderAgreedAction,
  sendProjectChangeOrderAction,
} from "./etterfakturering-actions"

type ManualBasis = Exclude<ChangeOrderApprovalBasis, "customer_otp">

const TONE_CLASS: Record<ReturnType<typeof describeChangeOrderStatus>["tone"], string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  waiting: "bg-amber-50 text-amber-800",
  ok: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-700",
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("no-NO", { day: "numeric", month: "short" })
}

function parseAmount(value: string) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type FormState = {
  title: string
  description: string
  fixedPriceNok: string
  hourlyRateNok: string
  estimatedHours: string
}

const EMPTY_FORM: FormState = { title: "", description: "", fixedPriceNok: "", hourlyRateNok: "", estimatedHours: "" }

/**
 * Tilleggsarbeid på prosjektet. Overfor privatkunder skal tillegg avtales før de
 * utføres (håndverkertjenesteloven § 9) – derfor må hver ekstrajobb enten sendes
 * til kunden for godkjenning, eller registreres som avtalt med grunnlag.
 */
export function EtterfaktureringTab({
  projectId,
  canManage,
  initialItems,
  customerEmail,
  onChanged,
}: {
  projectId: string
  canManage: boolean
  initialItems: ChangeOrder[] | null
  /** Prosjektkundens e-post – foreslås som mottaker. */
  customerEmail?: string | null
  /** Kalles når lista er endret, så fakturagrunnlaget over kan hentes på nytt. */
  onChanged?: () => void
}) {
  const [items, setItems] = useState<ChangeOrder[]>(initialItems ?? [])
  const [loading, setLoading] = useState(!initialItems)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [billingType, setBillingType] = useState<ChangeOrderBillingType>("fixed")
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [approvalMode, setApprovalMode] = useState<"send" | "agreed">("send")
  const [recipientEmail, setRecipientEmail] = useState(customerEmail ?? "")
  const [basis, setBasis] = useState<ManualBasis>("agreed_on_site")
  const [note, setNote] = useState("")
  const [agreeTarget, setAgreeTarget] = useState<ChangeOrder | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const confirm = useConfirm()

  const load = useCallback(() => {
    setLoading(true)
    listProjectChangeOrdersAction(projectId)
      .then(setItems)
      .catch((error) => {
        reportClientError(error, { context: { action: "list project change orders", projectId } })
        toast.error("Kunne ikke laste ekstrajobbene. Prøv igjen.")
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    if (!initialItems) load()
  }, [initialItems, load])

  const previewAmount = useMemo(() => {
    if (billingType === "hourly") {
      const rate = parseAmount(form.hourlyRateNok)
      const hours = parseAmount(form.estimatedHours)
      return rate && hours ? rate * hours : null
    }
    return parseAmount(form.fixedPriceNok)
  }, [billingType, form.fixedPriceNok, form.hourlyRateNok, form.estimatedHours])

  function resetDialog() {
    setBillingType("fixed")
    setForm(EMPTY_FORM)
    setApprovalMode("send")
    setRecipientEmail(customerEmail ?? "")
    setBasis("agreed_on_site")
    setNote("")
  }

  function afterChange() {
    load()
    onChanged?.()
  }

  async function handleCreate() {
    const title = form.title.trim()
    if (!title) {
      toast.error("Skriv hva ekstrajobben gjelder")
      return
    }
    if (!previewAmount) {
      toast.error(billingType === "hourly" ? "Skriv inn timepris og antall timer" : "Skriv inn prisen")
      return
    }
    if (approvalMode === "send" && !recipientEmail.trim()) {
      toast.error("Skriv inn kundens e-post, så kan de godkjenne")
      return
    }

    setSaving(true)
    try {
      const result = await createProjectChangeOrderAction({
        projectId,
        billingType,
        title,
        description: form.description.trim(),
        ...(billingType === "hourly"
          ? { hourlyRateNok: parseAmount(form.hourlyRateNok), estimatedHours: parseAmount(form.estimatedHours) }
          : { fixedPriceNok: parseAmount(form.fixedPriceNok) }),
        approval:
          approvalMode === "send"
            ? { mode: "send", recipientEmail: recipientEmail.trim() }
            : { mode: "agreed", basis, note },
      })
      if (!result.ok) {
        toast.error(result.error)
        afterChange()
        return
      }
      resetDialog()
      setOpen(false)
      afterChange()
      toast.success(approvalMode === "send" ? "Sendt til kunden for godkjenning" : "Ekstrajobben er registrert som avtalt")
    } catch (error) {
      reportClientError(error, { context: { action: "create project change order", projectId } })
      toast.error("Kunne ikke lagre ekstrajobben. Prøv igjen.")
    } finally {
      setSaving(false)
    }
  }

  async function handleSend(item: ChangeOrder) {
    const reminder = item.status === "sent"
    setBusyId(item.id)
    try {
      const result = await sendProjectChangeOrderAction({ projectId, id: item.id })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(reminder ? "Påminnelse sendt" : "Sendt til kunden for godkjenning")
      afterChange()
    } catch (error) {
      reportClientError(error, { context: { action: "send project change order", projectId, changeOrderId: item.id } })
      toast.error("Kunne ikke sende. Prøv igjen.")
    } finally {
      setBusyId(null)
    }
  }

  async function handleMarkAgreed() {
    if (!agreeTarget) return
    setBusyId(agreeTarget.id)
    try {
      const result = await markChangeOrderAgreedAction({ projectId, id: agreeTarget.id, basis, note })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success("Registrert som avtalt")
      setAgreeTarget(null)
      setNote("")
      afterChange()
    } catch (error) {
      reportClientError(error, { context: { action: "mark change order agreed", projectId } })
      toast.error("Kunne ikke lagre. Prøv igjen.")
    } finally {
      setBusyId(null)
    }
  }

  async function handleCopyLink(item: ChangeOrder) {
    if (!item.public_slug) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/tilleggsarbeid/${item.public_slug}`)
      setCopiedId(item.id)
      toast.success("Lenken er kopiert – send den på SMS om kunden ikke finner e-posten")
      window.setTimeout(() => setCopiedId(null), 2000)
    } catch {
      toast.error("Kunne ikke kopiere lenken")
    }
  }

  async function handleDelete(item: ChangeOrder) {
    const ok = await confirm({
      title: `Slette «${item.title}»?`,
      description: "Ekstrajobben fjernes fra prosjektet.",
      confirmText: "Slett",
      variant: "destructive",
    })
    if (!ok) return

    setBusyId(item.id)
    try {
      const result = await deleteProjectChangeOrderAction({ projectId, id: item.id })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      afterChange()
      toast.success("Ekstrajobb slettet")
    } catch (error) {
      reportClientError(error, { context: { action: "delete project change order", projectId, changeOrderId: item.id } })
      toast.error("Kunne ikke slette. Prøv igjen.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="py-2">
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Tilleggsarbeid</p>
            <p className="text-xs text-muted-foreground">Kunden godkjenner før arbeidet gjøres – med navn og engangskode.</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-9" onClick={load} disabled={loading} aria-label="Oppdater">
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
            {canManage ? (
              <Button size="sm" className="h-9 gap-1.5" onClick={() => setOpen(true)}>
                <Plus className="h-3.5 w-3.5" />
                Ny ekstrajobb
              </Button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Laster ekstrajobber …
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Ingen ekstrajobber ennå. Dukker det opp noe utenfor tilbudet, legg det inn her og send det til kunden.
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => {
              const status = describeChangeOrderStatus(item)
              const awaitingAnswer = item.status === "draft" || item.status === "sent"
              const sentAt = formatDate(item.sent_at)
              const reminderAt = formatDate(item.reminder_sent_at)
              const respondedAt = formatDate(item.customer_responded_at)
              return (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{item.title}</p>
                      {item.description ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.billing_type === "hourly" && item.hourly_rate_nok && item.estimated_hours
                          ? `${item.estimated_hours} t × ${formatNok(Number(item.hourly_rate_nok))} · `
                          : "Fastpris · "}
                        {item.status === "sent" && sentAt
                          ? `sendt ${sentAt}${reminderAt ? `, påminnet ${reminderAt}` : ""}`
                          : respondedAt && item.status !== "draft"
                            ? `besvart ${respondedAt}`
                            : `lagt inn ${formatDate(item.created_at) ?? ""}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums">{formatNok(Number(item.amount_nok || 0))}</p>
                      <p className="text-[11px] text-muted-foreground">eks. mva</p>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", TONE_CLASS[status.tone])}>
                      {status.label}
                    </span>
                    {canManage && awaitingAnswer ? (
                      <>
                        <Button
                          size="sm"
                          variant={item.status === "draft" ? "default" : "outline"}
                          className="h-9 gap-1.5"
                          disabled={busyId === item.id}
                          onClick={() => void handleSend(item)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {item.status === "sent" ? "Send påminnelse" : "Send til kunden"}
                        </Button>
                        {item.status === "sent" && item.public_slug ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-9 gap-1.5"
                            onClick={() => void handleCopyLink(item)}
                          >
                            {copiedId === item.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            Kopier lenke
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-9"
                          disabled={busyId === item.id}
                          onClick={() => {
                            setBasis("agreed_on_site")
                            setNote("")
                            setAgreeTarget(item)
                          }}
                        >
                          Registrer som avtalt
                        </Button>
                      </>
                    ) : null}
                    {canManage ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="ml-auto h-9 w-9 text-muted-foreground"
                        disabled={busyId === item.id}
                        onClick={() => void handleDelete(item)}
                        aria-label={`Slett ${item.title}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ResponsiveDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (saving) return
          setOpen(nextOpen)
        }}
      >
        <ResponsiveDialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <ResponsiveDialogHeader className="md:text-left">
            <ResponsiveDialogTitle>Ny ekstrajobb</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Arbeid som ikke var med i tilbudet.</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-4 px-4 md:px-0">
            <div className="space-y-2">
              <Label htmlFor="extra-title">Hva gjelder det?</Label>
              <Input
                id="extra-title"
                value={form.title}
                placeholder="F.eks. Bytte råtten svill under vinduet"
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="extra-description">Beskrivelse (valgfritt)</Label>
              <Textarea
                id="extra-description"
                rows={3}
                value={form.description}
                placeholder="Hva skal gjøres, og hvorfor det ikke var med i tilbudet."
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>

            <div role="radiogroup" aria-label="Pris" className="inline-flex w-full rounded-md bg-secondary p-0.5 text-sm">
              {(["fixed", "hourly"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={billingType === type}
                  onClick={() => setBillingType(type)}
                  className={cn(
                    "min-h-10 flex-1 rounded-[4px] px-3 font-medium transition-colors",
                    billingType === type ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                  )}
                >
                  {type === "fixed" ? "Fastpris" : "Per time"}
                </button>
              ))}
            </div>

            {billingType === "fixed" ? (
              <div className="space-y-2">
                <Label htmlFor="extra-fixed-price">Pris eks. mva</Label>
                <Input
                  id="extra-fixed-price"
                  inputMode="decimal"
                  value={form.fixedPriceNok}
                  placeholder="0"
                  onChange={(event) => setForm((current) => ({ ...current, fixedPriceNok: event.target.value }))}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="extra-hourly-rate">Timepris eks. mva</Label>
                  <Input
                    id="extra-hourly-rate"
                    inputMode="decimal"
                    value={form.hourlyRateNok}
                    placeholder="0"
                    onChange={(event) => setForm((current) => ({ ...current, hourlyRateNok: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="extra-estimated-hours">Antall timer</Label>
                  <Input
                    id="extra-estimated-hours"
                    inputMode="decimal"
                    value={form.estimatedHours}
                    placeholder="0"
                    onChange={(event) => setForm((current) => ({ ...current, estimatedHours: event.target.value }))}
                  />
                </div>
              </div>
            )}

            {previewAmount !== null ? (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                Totalt <span className="font-semibold tabular-nums">{formatNok(previewAmount)}</span> eks. mva
              </p>
            ) : null}

            <fieldset className="space-y-2 border-t pt-4">
              <legend className="text-sm font-medium">Kundens godkjenning</legend>
              <ApprovalChoice
                selected={approvalMode === "send"}
                onSelect={() => setApprovalMode("send")}
                title="Send til kunden for godkjenning"
                description="Kunden får en lenke og godkjenner med navn og engangskode."
              />
              {approvalMode === "send" ? (
                <div className="space-y-1.5 pl-1">
                  <Label htmlFor="extra-recipient" className="text-xs text-muted-foreground">
                    Kundens e-post
                  </Label>
                  <Input
                    id="extra-recipient"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={recipientEmail}
                    placeholder="kunde@eksempel.no"
                    onChange={(event) => setRecipientEmail(event.target.value)}
                  />
                </div>
              ) : null}
              <ApprovalChoice
                selected={approvalMode === "agreed"}
                onSelect={() => setApprovalMode("agreed")}
                title="Allerede avtalt med kunden"
                description="Registrer hvordan det ble avtalt."
              />
              {approvalMode === "agreed" ? (
                <AgreedBasisFields basis={basis} onBasisChange={setBasis} note={note} onNoteChange={setNote} />
              ) : null}
            </fieldset>
          </div>

          <ResponsiveDialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setOpen(false)} disabled={saving}>
              Avbryt
            </Button>
            <Button className="h-11 gap-1.5 sm:h-9" onClick={() => void handleCreate()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : approvalMode === "send" ? <Send className="h-4 w-4" /> : null}
              {approvalMode === "send" ? "Send til godkjenning" : "Lagre som avtalt"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={agreeTarget !== null} onOpenChange={(nextOpen) => (!nextOpen ? setAgreeTarget(null) : null)}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader className="md:text-left">
            <ResponsiveDialogTitle>Registrer som avtalt</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>{agreeTarget?.title}</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="px-4 md:px-0">
            <AgreedBasisFields basis={basis} onBasisChange={setBasis} note={note} onNoteChange={setNote} />
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setAgreeTarget(null)}>
              Avbryt
            </Button>
            <Button className="h-11 sm:h-9" onClick={() => void handleMarkAgreed()} disabled={busyId !== null} autoFocus>
              Lagre som avtalt
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}

function ApprovalChoice({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/40"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-foreground" : "border-muted-foreground/50"
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-foreground" /> : null}
      </span>
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function AgreedBasisFields({
  basis,
  onBasisChange,
  note,
  onNoteChange,
}: {
  basis: ManualBasis
  onBasisChange: (value: ManualBasis) => void
  note: string
  onNoteChange: (value: string) => void
}) {
  return (
    <div className="space-y-2 pl-1">
      <div role="radiogroup" aria-label="Hvordan ble det avtalt?" className="grid gap-1.5">
        {MANUAL_APPROVAL_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm",
              basis === option.value ? "border-foreground/60 bg-muted/40" : "hover:bg-muted/30"
            )}
          >
            <input
              type="radio"
              name="approval-basis"
              className="mt-1"
              checked={basis === option.value}
              onChange={() => onBasisChange(option.value)}
            />
            <span>
              <span className="block font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <Textarea
        rows={2}
        value={note}
        placeholder="Notat (valgfritt), f.eks. «Avtalt med Kari på telefon 24.09»"
        onChange={(event) => onNoteChange(event.target.value)}
      />
    </div>
  )
}
