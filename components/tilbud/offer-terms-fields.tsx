"use client"

import { ExternalLink } from "lucide-react"

import { InfoHint } from "@/components/ui/info-hint"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CONTRACT_BASIS_OPTIONS,
  OFFER_TERMS_GUIDE_URL,
  PRICING_MODEL_OPTIONS,
  SELECTABLE_PRICING_MODELS,
  toSelectablePricingModel,
} from "@/lib/tilbud/offer-terms"
import type { OfferContractBasis, OfferPricingModel } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"

function GuideLink() {
  return (
    <a
      href={OFFER_TERMS_GUIDE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
    >
      Les guiden om NS 8405, NS 8407 og endringer
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  )
}

/**
 * Prismodell og kontraktsgrunnlag — vilkårene kunden signerer på. Velges
 * eksplisitt i stedet for å gjettes ut fra linjene, og vises rett over
 * forhåndsvisningen så håndverkeren ser hva kunden får.
 */
export function OfferTermsFields({
  pricingModel,
  contractBasis,
  onPricingModelChange,
  onContractBasisChange,
  disabled = false,
  className,
}: {
  pricingModel: OfferPricingModel
  contractBasis: OfferContractBasis
  onPricingModelChange: (value: OfferPricingModel) => void
  onContractBasisChange: (value: OfferContractBasis) => void
  disabled?: boolean
  className?: string
}) {
  const selectedModel = toSelectablePricingModel(pricingModel)
  const selectedBasis = CONTRACT_BASIS_OPTIONS.find((option) => option.value === contractBasis)

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>
      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label id="offer-pricing-model-label">Prismodell</Label>
          <InfoHint title="Prismodell">
            <p>
              <strong className="text-foreground">Regningsarbeid:</strong> {PRICING_MODEL_OPTIONS.time_materials.description}{" "}
              Overfor privatkunder kan et prisoverslag ikke overskrides vesentlig uten at kunden er varslet.
            </p>
            <p>
              <strong className="text-foreground">Fastpris:</strong> {PRICING_MODEL_OPTIONS.fixed.description} Du bærer
              risikoen hvis jobben tar lengre tid enn beregnet.
            </p>
            <p>
              <GuideLink />
            </p>
          </InfoHint>
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
                "flex-1 cursor-pointer rounded-[4px] px-3 py-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                selectedModel === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {PRICING_MODEL_OPTIONS[value].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedModel
            ? PRICING_MODEL_OPTIONS[selectedModel].description
            : "Tilbudet bruker en eldre prismodell. Velg regningsarbeid eller fastpris."}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <Label htmlFor="offer-contract-basis">Kontraktsgrunnlag</Label>
          <InfoHint title="Kontraktsgrunnlag">
            {CONTRACT_BASIS_OPTIONS.map((option) => (
              <p key={option.value}>
                <strong className="text-foreground">{option.label}:</strong> {option.description}
              </p>
            ))}
            <p>
              Overfor privatkunder gjelder håndverkertjenesteloven eller bustadoppføringslova uansett hva som
              velges her.
            </p>
            <p>
              <GuideLink />
            </p>
          </InfoHint>
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
            {CONTRACT_BASIS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedBasis ? <p className="text-xs text-muted-foreground">{selectedBasis.description}</p> : null}
      </div>
    </div>
  )
}
