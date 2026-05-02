import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()

  // Verify auth
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: offerId } = params

  // Get offer
  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*, customer:customers(*)")
    .eq("id", offerId)
    .single()

  if (offerError || !offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  try {
    // 1. Establish connection to Tripletex / auth
    // 2. Generate PDF of the offer (if not already done)
    // 3. Create document in     // 3. Create document in     // 3. Create doct for signing to customer email via Tripletex API

    const mockExternalUrl = "https://tripletex.no/contracts/12345" // Mock

    // Update contract status in Supabase
    const { data: updatedOffer, error: updateError } = await supabase
      .from("offers")
      .update({
        contract: {
          status: "sent",
          provider: "tripletex",
          envelopeId: "ttx-" + Math.random().toString(36).slice(2, 8),
          sentAt: new Date().toISOString(),
          externalUrl: mockExternalUrl
        }
      })
      .eq("id", offerId)
      .select()
      .single()

    if (updateError) {
      throw new Error("Could not update offer status")
    }

    return NextResponse.json({ success: true, contract: updatedOffer.contract })
  } catch (error: any) {
    console.error("Tripletex Contract Error:", error)
    return NextResponse.json({ error: error.message || "Failed to send contract via Tripletex" }, { status: 500 })
  }
}
