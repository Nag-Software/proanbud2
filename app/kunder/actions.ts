"use server"

import { createClient } from "@/lib/supabase/server"
import { enqueueEntitySync } from "@/lib/regnskap/sync"
import { canAccessCustomers } from "@/lib/roles"
import { logServerError } from "@/lib/errors/log"
import { GENERIC_ERROR_MESSAGE } from "@/lib/errors/user-message"
import type { ActionResult } from "@/lib/errors/action-result"
import { revalidatePath } from "next/cache"

// Feil returneres som data (ActionResult) — aldri throw: Next.js maskerer
// kastede meldinger i produksjon, så brukeren ville fått en intetsigende feil
// på sin aller første handling i appen.

type CustomerAuthContext = { companyId: string; userId: string }

async function resolveCustomerAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  requiredMessage: string
): Promise<ActionResult<CustomerAuthContext>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: requiredMessage }
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    return { ok: false, error: "Kunne ikke hente bedriftsinformasjonen din. Prøv å laste siden på nytt." }
  }

  if (!canAccessCustomers(userData.role)) {
    return { ok: false, error: "Du har ikke tilgang til å administrere kunder. Be en administrator om hjelp." }
  }

  return { ok: true, data: { companyId: userData.company_id, userId: user.id } }
}

// Regnskapssynk er «best effort»: kunden er allerede lagret, så en hikke i
// synk-køen skal aldri vises som feil til brukeren. Går til den integrasjonen
// som faktisk er tilkoblet — Fiken eller Tripletex.
async function enqueueCustomerSync(companyId: string, customerId: string) {
  try {
    await enqueueEntitySync({
      companyId,
      jobType: "customer.upsert",
      payload: { customerId },
      idempotencyKey: `customer:${customerId}:upsert`,
    })
  } catch (error) {
    await logServerError({
      message: "Kunde lagret, men synk til regnskapet kunne ikke settes i kø",
      error,
      source: "action",
      route: "kunder/enqueueCustomerSync",
      context: { companyId, customerId },
    })
  }
}

export async function createCustomerAction(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  try {
    const supabase = await createClient()
    const access = await resolveCustomerAccess(supabase, "Du må være logget inn for å opprette en kunde.")
    if (!access.ok) return access
    const { companyId } = access.data

    // Map form data fields to DB
    const name = ((formData.get("name") as string) || "").trim()
    const email = formData.get("email") as string
    const phone = formData.get("phone") as string
    const org_number = formData.get("orgNumber") as string
    const address = formData.get("address") as string
    const postal_code = formData.get("postalCode") as string
    const city = formData.get("city") as string

    if (!name) {
      return { ok: false, error: "Skriv inn navnet på kunden." }
    }

    const { data, error } = await supabase
      .from("customers")
      .insert({
        company_id: companyId, // Knytt kunden til bedriften din
        name,
        email: email || null,
        phone: phone || null,
        org_number: org_number || null,
        address: address || null,
        postal_code: postal_code || null,
        city: city || null,
      })
      .select("id")
      .single()

    if (error || !data?.id) {
      await logServerError({
        message: "Kunne ikke opprette kunde",
        error,
        source: "action",
        route: "createCustomerAction",
        context: { companyId },
      })
      return { ok: false, error: "Kunne ikke lagre kunden. Prøv igjen om litt." }
    }

    await enqueueCustomerSync(companyId, data.id)

    revalidatePath("/kunder")
    return { ok: true, data: { id: data.id } }
  } catch (error) {
    await logServerError({
      message: "Uventet feil ved oppretting av kunde",
      error,
      source: "action",
      route: "createCustomerAction",
    })
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }
}

export async function updateCustomerAction(input: {
  id: string
  type: "privatperson" | "bedrift"
  name: string
  email?: string
  phone?: string
  orgNumber?: string
  address?: string
  postalCode?: string
  city?: string
}): Promise<ActionResult<void>> {
  try {
    const supabase = await createClient()
    const access = await resolveCustomerAccess(supabase, "Du må være logget inn for å oppdatere en kunde.")
    if (!access.ok) return access
    const { companyId } = access.data

    if (!input.name?.trim()) {
      return { ok: false, error: "Skriv inn navnet på kunden." }
    }

    const payload = {
      name: input.name.trim(),
      email: input.email || null,
      phone: input.phone || null,
      org_number: input.type === "bedrift" ? input.orgNumber || null : null,
      address: input.address || null,
      postal_code: input.postalCode || null,
      city: input.city || null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", input.id)
      .eq("company_id", companyId)

    if (error) {
      await logServerError({
        message: "Kunne ikke oppdatere kunde",
        error,
        source: "action",
        route: "updateCustomerAction",
        context: { companyId, customerId: input.id },
      })
      return { ok: false, error: "Kunne ikke lagre endringene. Prøv igjen om litt." }
    }

    await enqueueCustomerSync(companyId, input.id)

    revalidatePath("/kunder")
    revalidatePath(`/kunder/${input.id}`)
    return { ok: true, data: undefined }
  } catch (error) {
    await logServerError({
      message: "Uventet feil ved oppdatering av kunde",
      error,
      source: "action",
      route: "updateCustomerAction",
      context: { customerId: input.id },
    })
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }
}

export async function deleteCustomerAction(customerId: string): Promise<ActionResult<void>> {
  try {
    const supabase = await createClient()
    const access = await resolveCustomerAccess(supabase, "Du må være logget inn for å fjerne en kunde.")
    if (!access.ok) return access
    const { companyId } = access.data

    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("id", customerId)
      .eq("company_id", companyId)

    if (error) {
      // 23503 = foreign key violation: kunden er i bruk i prosjekter/tilbud
      if (error.code === "23503") {
        return {
          ok: false,
          error:
            "Kunden er knyttet til prosjekter eller tilbud og kan ikke slettes. Slett eller flytt disse først.",
        }
      }
      await logServerError({
        message: "Kunne ikke slette kunde",
        error,
        source: "action",
        route: "deleteCustomerAction",
        context: { companyId, customerId },
      })
      return { ok: false, error: "Kunne ikke slette kunden. Prøv igjen om litt." }
    }

    revalidatePath("/kunder")
    return { ok: true, data: undefined }
  } catch (error) {
    await logServerError({
      message: "Uventet feil ved sletting av kunde",
      error,
      source: "action",
      route: "deleteCustomerAction",
      context: { customerId },
    })
    return { ok: false, error: GENERIC_ERROR_MESSAGE }
  }
}
