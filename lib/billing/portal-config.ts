import "server-only"

import type Stripe from "stripe"

import { logServerError } from "@/lib/errors/log"

/**
 * Kundeportal uten oppsigelse.
 *
 * Oppsigelse skjer kun i Proanbud (Innstillinger → Betaling), der grunnen er
 * obligatorisk. Portalen åpnes derfor med en egen konfigurasjon som er en kopi
 * av standardoppsettet i Stripe, men med «avslutt abonnement» skrudd av.
 *
 * Konfigurasjonen lages én gang og gjenfinnes på metadata. Endres standard-
 * oppsettet i Stripe-dashbordet senere, må denne deaktiveres der så en ny
 * kopi lages.
 */
const CONFIG_KIND = "proanbud-uten-oppsigelse"

let cachedConfigurationId: string | null = null

function featuresWithoutCancel(
  source: Stripe.BillingPortal.Configuration | undefined
): Stripe.BillingPortal.ConfigurationCreateParams.Features {
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    subscription_cancel: { enabled: false },
    invoice_history: { enabled: source?.features.invoice_history.enabled ?? true },
    payment_method_update: { enabled: source?.features.payment_method_update.enabled ?? true },
  }

  const customerUpdate = source?.features.customer_update
  features.customer_update = customerUpdate?.enabled
    ? { enabled: true, allowed_updates: customerUpdate.allowed_updates }
    : source
      ? { enabled: false }
      : { enabled: true, allowed_updates: ["email", "address", "tax_id"] }

  const subscriptionUpdate = source?.features.subscription_update
  if (subscriptionUpdate?.enabled && subscriptionUpdate.products?.length) {
    features.subscription_update = {
      enabled: true,
      default_allowed_updates: subscriptionUpdate.default_allowed_updates,
      proration_behavior: subscriptionUpdate.proration_behavior,
      products: subscriptionUpdate.products.map((product) => ({
        product: product.product,
        prices: product.prices,
      })),
    }
  }

  return features
}

async function findOrCreateConfiguration(stripe: Stripe): Promise<string> {
  const configurations = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  })

  const existing = configurations.data.find((config) => config.metadata?.kind === CONFIG_KIND)
  if (existing) return existing.id

  const source = configurations.data.find((config) => config.is_default)
  const created = await stripe.billingPortal.configurations.create({
    features: featuresWithoutCancel(source),
    business_profile: {
      ...(source?.business_profile.headline ? { headline: source.business_profile.headline } : {}),
      ...(source?.business_profile.privacy_policy_url
        ? { privacy_policy_url: source.business_profile.privacy_policy_url }
        : {}),
      ...(source?.business_profile.terms_of_service_url
        ? { terms_of_service_url: source.business_profile.terms_of_service_url }
        : {}),
    },
    metadata: { kind: CONFIG_KIND },
  })
  return created.id
}

/**
 * Returnerer portal-konfigurasjonen uten oppsigelse, eller `null` hvis den
 * ikke lot seg hente/lage. Da åpnes standardportalen — betaling og kort må
 * aldri bli utilgjengelig fordi konfigurasjonen sviktet — og feilen logges.
 */
export async function getPortalConfigurationWithoutCancel(stripe: Stripe): Promise<string | null> {
  if (cachedConfigurationId) return cachedConfigurationId
  try {
    cachedConfigurationId = await findOrCreateConfiguration(stripe)
    return cachedConfigurationId
  } catch (error) {
    await logServerError({
      message: "Kundeportal uten oppsigelse kunne ikke settes opp — åpner standardportalen",
      error,
      level: "warning",
      source: "api",
      route: "/api/stripe/customer-portal",
    })
    return null
  }
}
