"use client"

import { useState, type ReactNode } from "react"
import { AlertTriangle, Building2, Check, ExternalLink, Info, Lock, User } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CONTRACT_BASIS_OPTIONS,
  contractBasisOptionsFor,
  contractBasisWarning,
  OFFER_TERMS_GUIDE_URL,
  PRICING_MODEL_OPTIONS,
  SELECTABLE_PRICING_MODELS,
  toSelectablePricingModel,
} from "@/lib/tilbud/offer-terms"
import type { CustomerKind, OfferContractBasis, OfferPricingModel } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"

/**
 * Prismodell og kontraktsgrunnlag — vilkårene kunden signerer på. Velges
 * eksplisitt i stedet for å gjettes ut fra linjene.
 *
 * Forklaringen ligger bak (i) som valgkort: den som lurer, leser og velger i samme
 * visning. Feltene selv holdes rene — kortene viser det samme som en hjelpetekst
 * under feltet ville gjort.
 */
export function OfferTermsFields({
  pricingModel,
  contractBasis,
  onPricingModelChange,
  onContractBasisChange,
  customerKind = null,
  disabled = false,
  className,
}: {
  pricingModel: OfferPricingModel
  contractBasis: OfferContractBasis
  onPricingModelChange: (value: OfferPricingModel) => void
  onContractBasisChange: (value: OfferContractBasis) => void
  /** Kundens type. Styrer hvilke kontrakter som vises; null = alle (f.eks. bedriftens standardvalg). */
  customerKind?: CustomerKind | null
  disabled?: boolean
  className?: string
}) {
  const selectedModel = toSelectablePricingModel(pricingModel)
  const selectedBasis = CONTRACT_BASIS_OPTIONS.find((option) => option.value === contractBasis)
  const basisOptions = contractBasisOptionsFor(customerKind)
  const basisWarning = contractBasisWarning(contractBasis, customerKind)
  // Et eldre valg som ikke passer kunden vises likevel i listen, så feltet ikke
  // står tomt — advarselen under forklarer hva som bør velges i stedet.
  const visibleBasisOptions =
    selectedBasis && !basisOptions.some((option) => option.value === contractBasis)
      ? [...basisOptions, selectedBasis]
      : basisOptions

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label id="offer-pricing-model-label">Prismodell</Label>
          <TermsGuide
            title="Prismodell"
            description="Hvordan kunden betaler for jobben."
            disabled={disabled}
          >
            {(close) =>
              SELECTABLE_PRICING_MODELS.map((value) => {
                const option = PRICING_MODEL_OPTIONS[value]
                const points =
                  option.consumerPoint && customerKind !== "bedrift"
                    ? [...option.points, option.consumerPoint]
                    : option.points
                return (
                  <OptionCard
                    key={value}
                    title={option.label}
                    selected={selectedModel === value}
                    disabled={disabled}
                    onSelect={() => {
                      onPricingModelChange(value)
                      close()
                    }}
                  >
                    <span className="block">{option.summary}</span>
                    <span className="mt-2 block space-y-1">
                      {points.map((point) => (
                        <span key={point} className="flex gap-2">
                          <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                          <span>{point}</span>
                        </span>
                      ))}
                    </span>
                  </OptionCard>
                )
              })
            }
          </TermsGuide>
        </div>
        <div
          role="radiogroup"
          aria-labelledby="offer-pricing-model-label"
          className="inline-flex w-full rounded-md bg-secondary p-0.5 text-sm"
        >
          {SELECTABLE_PRICING_MODELS.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selectedModel === value}
              disabled={disabled}
              onClick={() => onPricingModelChange(value)}
              className={cn(
                "min-h-9 flex-1 cursor-pointer rounded-[4px] px-3 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                selectedModel === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {PRICING_MODEL_OPTIONS[value].label}
            </button>
          ))}
        </div>
        {!selectedModel ? (
          <p className="text-xs text-muted-foreground">
            Tilbudet bruker en eldre prismodell. Velg regningsarbeid eller fastpris.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="offer-contract-basis">Kontraktsgrunnlag</Label>
          <TermsGuide
            title="Kontraktsgrunnlag"
            description="Hvilke kontraktsregler som gjelder for jobben."
            badge={customerKind ? <CustomerKindBadge kind={customerKind} /> : null}
            note={
              customerKind === "bedrift"
                ? "NS-standardene er laget for avtaler mellom profesjonelle parter."
                : "Overfor privatkunder gjelder håndverkertjenesteloven eller bustadoppføringslova uansett. Vilkår kan ikke være dårligere for kunden enn loven."
            }
            disabled={disabled}
          >
            {(close) =>
              basisOptions.map((option) => (
                <OptionCard
                  key={option.value}
                  title={option.label}
                  tag={option.tag}
                  selected={contractBasis === option.value}
                  disabled={disabled}
                  onSelect={() => {
                    onContractBasisChange(option.value)
                    close()
                  }}
                >
                  {option.description}
                </OptionCard>
              ))
            }
          </TermsGuide>
        </div>
        <Select
          value={contractBasis}
          onValueChange={(value) => onContractBasisChange(value as OfferContractBasis)}
          disabled={disabled}
        >
          <SelectTrigger id="offer-contract-basis" className="w-full">
            <SelectValue placeholder="Velg kontraktsgrunnlag" />
          </SelectTrigger>
          <SelectContent>
            {visibleBasisOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {basisWarning ? (
          <p role="alert" className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{basisWarning}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

function CustomerKindBadge({ kind }: { kind: CustomerKind }) {
  const Icon = kind === "bedrift" ? Building2 : User
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground">
      <Icon className="size-3.5" aria-hidden="true" />
      {kind === "bedrift" ? "Bedriftskunde" : "Privatkunde"}
    </span>
  )
}

/**
 * (i)-knappen og dialogen med valgkortene. Bunnark på mobil, dialog på desktop.
 */
function TermsGuide({
  title,
  description,
  badge,
  note,
  disabled,
  children,
}: {
  title: string
  description: string
  badge?: ReactNode
  note?: string
  disabled?: boolean
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Forklaring: ${title}`}
          // Ikonet er 14px, men trykkflaten 24px — mulig å treffe med arbeidshanske.
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" />
        </button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader className="gap-1.5 md:text-left">
          <ResponsiveDialogTitle className="text-base">{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
          {badge ? <div className="mt-1 flex justify-center md:justify-start">{badge}</div> : null}
        </ResponsiveDialogHeader>

        <div className="space-y-2 px-4 md:px-0" role="radiogroup" aria-label={title}>
          {children(() => setOpen(false))}
        </div>

        {note ? (
          <p className="mx-4 mt-1 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground md:mx-0">
            {note}
          </p>
        ) : null}

        {disabled ? (
          <p className="mx-4 flex items-center gap-1.5 text-xs text-muted-foreground md:mx-0">
            <Lock className="size-3.5" aria-hidden="true" />
            Tilbudet er akseptert, så vilkårene kan ikke endres.
          </p>
        ) : null}

        <ResponsiveDialogFooter className="md:justify-start">
          <Button variant="outline" asChild className="w-full md:w-auto">
            <a href={OFFER_TERMS_GUIDE_URL} target="_blank" rel="noopener noreferrer">
              Les guiden om kontrakter og endringer
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

/**
 * Ett valg som kort: tittel, valgfri merkelapp og forklaring. Trykk velger og
 * lukker dialogen. Valgt kort har mørk ramme og hake.
 */
function OptionCard({
  title,
  tag,
  selected,
  disabled,
  onSelect,
  children,
}: {
  title: string
  tag?: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "block w-full rounded-xl border bg-card p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
        selected
          ? "border-foreground ring-1 ring-foreground"
          : "border-border hover:border-foreground/30 hover:bg-muted/40 disabled:hover:border-border disabled:hover:bg-card"
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          {tag ? (
            <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {tag}
            </span>
          ) : null}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
            selected ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40"
          )}
        >
          {selected ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="mt-2 block text-[13px] leading-relaxed text-muted-foreground">{children}</span>
    </button>
  )
}
