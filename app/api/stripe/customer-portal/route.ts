import { NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

type StripeCustomer = {
  id: string
}

type StripeListResponse<T> = {
  data: T[]
}

function getBaseUrl(request: Request) {
  const origin = request.headers.get("origin")
  if (origin) return origin

  const host = request.headers.get("host")
  if (!host) return "http://localhost:3000"

  const protocol = process.env.NODE_ENV === "development" ? "http" : "https"
  return `${protocol}://${host}`
}

async function stripeRequest<T>(path: string, init?: RequestInit) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY mangler")
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(init?.headers || {}),
    },
  })

  const data = await response.json()
  if (!response.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : "Stripe-feil"
    throw new Error(message)
  }

  return data as T
}

async function findOrCreateStripeCustomer(input: {
  companyId: string
  companyName: string
  companyOrgNumber: string | null
  email: string
  fullName: string
}) {
  const searchParams = new URLSearchParams()
  searchParams.set("query", `metadata['company_id']:'${input.companyId}'`)

  const existing = await stripeRequest<StripeListResponse<StripeCustomer>>(
    `/customers/search?${searchParams.toString()}`,
    { method: "GET", headers: { "Content-Type": "application/json" } }
  )

  if (existing.data[0]) {
    return existing.data[0].id
  }

  const createParams = new URLSearchParams()
  createParams.set("email", input.email)
  createParams.set("name", input.companyName || input.fullName || input.email)
  createParams.set("metadata[company_id]", input.companyId)
  createParams.set("metadata[user_name]", input.fullName)
  if (input.companyOrgNumber) {
    createParams.set("metadata[org_number]", input.companyOrgNumber)
  }

  const customer = await stripeRequest<StripeCustomer>("/customers", {
    method: "POST",
    body: createParams.toString(),
  })

  return customer.id
}

export async function POST(request: Request) {
  try {
    const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim()
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY?.trim()

    if (!stripePublishableKey || !stripeSecretKey) {
      return NextResponse.json(
        { error: "Stripe er ikke konfigurert på serveren." },
        { status: 500 }
      )
    }

    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Du er ikke logget inn." }, { status: 401 })
    }

    const { data: userRow, error: userError } = await supabase
      .from("users")
      .select("company_id, full_name, email")
      .eq("id", user.id)
      .maybeSingle()

    if (userError || !userRow?.company_id) {
      return NextResponse.json(
        { error: "Fant ikke aktiv Proanbud-bedrift for brukeren." },
        { status: 400 }
      )
    }

    const { data: companyRow } = await supabase
      .from("companies")
      .select("name, org_number")
      .eq("id", userRow.company_id)
      .maybeSingle()

    const customerId = await findOrCreateStripeCustomer({
      companyId: userRow.company_id,
      companyName: companyRow?.name || userRow.full_name || user.email || "Proanbud kunde",
      companyOrgNumber: companyRow?.org_number || null,
      email: userRow.email || user.email || "",
      fullName: userRow.full_name || user.user_metadata?.full_name || user.email || "",
    })

    const returnUrl = `${getBaseUrl(request)}/`
    const portalParams = new URLSearchParams()
    portalParams.set("customer", customerId)
    portalParams.set("return_url", returnUrl)

    const portalSession = await stripeRequest<{ url: string }>("/billing_portal/sessions", {
      method: "POST",
      body: portalParams.toString(),
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