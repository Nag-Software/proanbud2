"use client"

import { Lock } from "lucide-react"

import { Switch } from "@/components/ui/switch"
import type { CapabilityStatus } from "@/lib/regnskap/capabilities"
import type { AccountingCapability, AccountingScopeConfig, AccountingScopeKey } from "@/lib/regnskap/types"

export type ScopeItem = {
  key: AccountingScopeKey
  capability: AccountingCapability
  label: string
  description: string
}

/**
 * Samme liste for begge regnskapssystemene.
 *
 * Brytere for ting leverandøren ikke kan forsvinner IKKE — de vises låst med en
 * forklaring. Skjulte forskjeller er verre enn synlige: da lurer brukeren på om
 * hen har oversett en innstilling.
 *
 * Etikettene holder full tekstfarge også når bryteren er låst. Å gråne både
 * etikett og forklaring gjorde raden nesten uleselig, og den låste raden er
 * nettopp den brukeren trenger å forstå.
 */
export function ScopeToggles({
  scopes,
  capabilities,
  items,
  disabled,
  onChange,
}: {
  scopes: AccountingScopeConfig
  capabilities: Record<AccountingCapability, CapabilityStatus>
  items: ScopeItem[]
  disabled?: boolean
  onChange: (key: AccountingScopeKey, value: boolean) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => {
        const capability = capabilities[item.capability]
        const supported = capability?.supported === true
        const on = supported && scopes[item.key] === true

        return (
          <div
            key={item.key}
            className={`flex items-start justify-between gap-4 rounded-md border-l-2 py-2.5 pl-3 pr-2 ${
              on
                ? "border-l-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30"
                : supported
                  ? "border-l-border bg-muted/30"
                  : "border-l-transparent bg-transparent"
            }`}
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {item.label}
                {!supported && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {supported ? item.description : capability?.unsupportedReason}
              </p>
            </div>
            <Switch
              checked={on}
              disabled={disabled || !supported}
              aria-label={item.label}
              onCheckedChange={(value) => onChange(item.key, value)}
            />
          </div>
        )
      })}
    </div>
  )
}
