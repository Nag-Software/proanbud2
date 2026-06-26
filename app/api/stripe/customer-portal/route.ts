import { NextResponse } from "next/server"

import type Stripe from "stripe"

import { requireCompanyAdmin } from "@/lib/billing/guards"
import { isStripeResourceMissing } from "@/lib/billing/stripe-helpers"
import { isStripeConfigured } from "@/lib/stripe/server"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

function getBaseUrl(request: Request) {
  const origin = request.headers.get("origin")
  if (origin) return origin

  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")

  const host = request.headers.get("host")
  if (!host) return "http://localhost:3000"

  const protocol = process.env.NODE_ENV === "development" ? "http" : "https"
  return `${protocol}://${host}`
}

async function findOrCreateStripeCustomer(input: {
  companyId: string
  companyName: string
  companyOrgNumber: string | null
  email: string
  fullName: string
}) {
  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_customer_id")
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (billing?.stripe_customer_id) {
    // Verify the stored customer still exists before opening a portal session.
    try {
      const customer = await stripe.customers.retrieve(billing.stripe_customer_id)
      if (!(customer as Stripe.DeletedCustomer).deleted) {
        return billing.stripe_customer_id
      }
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error
    }
    await admin
      .from("company_billing")
      .update({ stripe_customer_id: null, updated_at: new Date().toISOString() })
      .eq("company_id", input.companyId)
  }

  const search = await stripe.customers.search({
    query: `metadata['company_id']:'${input.companyId}'`,
    limit: 1,
  })

  if (search.data[0]) {
    const customerId = search.data[0].id
    await admin
      .from("company_billing")
      .upsert(
        {
          company_id: input.companyId,
          stripe_customer_id: customerId,
        },
        { onConflict: "company_id" }
      )
    return customerId
  }

  const customer = await stripe.customers.create({
    email: input.email,
    name: input.companyName || input.fullName || input.email,
    metadata: {
      company_id: input.companyId,
      user_name: input.fullName,
      ...(input.companyOrgNumber ? { org_number: input.companyOrgNumber } : {}),
    },
  })

  await admin
    .from("company_billing")
    .upsert(
      {
        company_id: input.companyId,
        stripe_customer_id: customer.id,
      },
      { onConflict: "company_id" }
    )

  return customer.id
}

export async function POST(request: Request) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: "Stripe er ikke konfigurert på serveren." },
        { status: 500 }
      )
    }

    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const supabase = await createClient()
    const { data: companyRow } = await supabase
      .from("companies")
      .select("name, org_number")
      .eq("id", auth.context.companyId)
      .maybeSingle()

    const customerId = await findOrCreateStripeCustomer({
      companyId: auth.context.companyId,
      companyName: companyRow?.name || auth.context.fullName,
      companyOrgNumber: companyRow?.org_number || null,
      email: auth.context.email,
      fullName: auth.context.fullName,
    })

    const stripe = getStripe()
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getBaseUrl(request)}/innstillinger/betaling`,
    })

    return NextResponse.json({ url: portalSession.url })
  } catch (error) {
    console.error("Stripe customer portal error", error)
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Kunne ikke opprette Stripe-portalen.",
      },
      { status: 500 }
    )
  }
}
