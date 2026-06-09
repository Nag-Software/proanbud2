"use server"

import { createClient } from "@/lib/supabase/server"
import { enqueueEntityTripletexSync, processTripletexQueueInBackground } from "@/lib/integrations/tripletex/sync"
import { revalidatePath } from "next/cache"

export async function createCustomerAction(formData: FormData) {
  const supabase = await createClient()

  // Sjekk hvem som er innlogget
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn for å opprette en kunde.")
  }

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente din bedriftsinformasjon.")
  }

  // Map form data fields to DB
  const name = formData.get("name") as string
  const email = formData.get("email") as string
  const phone = formData.get("phone") as string
  const org_number = formData.get("orgNumber") as string
  const address = formData.get("address") as string
  const postal_code = formData.get("postalCode") as string
  const city = formData.get("city") as string

  const { data, error } = await supabase.from("customers").insert({
    company_id: userData.company_id, // Knytt kunden til bedriften din
    name,
    email: email || null,
    phone: phone || null,
    org_number: org_number || null,
    address: address || null,
    postal_code: postal_code || null,
    city: city || null
  }).select('id').single()

  if (error) {
    throw new Error(error.message)
  }

  await enqueueEntityTripletexSync({
    companyId: userData.company_id,
    jobType: "customer.upsert",
    payload: { customerId: data.id },
    idempotencyKey: `customer:${data.id}:upsert`,
  })
  processTripletexQueueInBackground()

  revalidatePath("/kunder")
  return data.id
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
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn for å oppdatere en kunde.")
  }

  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userData?.company_id) {
    throw new Error("Kunne ikke hente din bedriftsinformasjon.")
  }

  const payload = {
    name: input.name,
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
    .eq("company_id", userData.company_id)

  if (error) {
    throw new Error(error.message)
  }

  await enqueueEntityTripletexSync({
    companyId: userData.company_id,
    jobType: "customer.upsert",
    payload: { customerId: input.id },
    idempotencyKey: `customer:${input.id}:upsert`,
  })
  processTripletexQueueInBackground()

  revalidatePath("/kunder")
  revalidatePath(`/kunder/${input.id}`)
}