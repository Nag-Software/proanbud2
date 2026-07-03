import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { searchBrregEnheter, mapEnhetToProspect } from "@/lib/outreach/brreg"
import { logServerError } from "@/lib/errors/log"

export const dynamic = "force-dynamic"

/** Navnesøk i Brønnøysund for «Nytt lead»-dialogen. Returnerer kandidater med
 *  flagg for om firmaet allerede finnes som prospect eller kunde. */
export async function GET(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q")?.trim() ?? ""
  if (q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  try {
    // Rent org.nr-søk? Brreg matcher det ikke via `navn` — men enhets-API-et
    // aksepterer organisasjonsnummer som eget parameter kun på eksakt-oppslag,
    // så vi lar navnesøket stå og lar brukeren lime inn navn. 9 siffer = org.nr:
    const isOrgNumber = /^\d{9}$/.test(q.replace(/\s/g, ""))
    const page = await searchBrregEnheter({
      naeringskoder: [],
      navn: isOrgNumber ? undefined : q,
      ...(isOrgNumber ? {} : {}),
      size: 12,
      page: 0,
    })

    let enheter = page.enheter
    if (isOrgNumber) {
      const orgnr = q.replace(/\s/g, "")
      const res = await fetch(
        `https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr}`,
        { headers: { Accept: "application/json" }, cache: "no-store" }
      )
      enheter = res.ok ? [await res.json()] : []
    }

    const mapped = enheter
      .map((enhet) => ({ enhet, row: mapEnhetToProspect(enhet) }))
      .filter((x): x is { enhet: (typeof enheter)[number]; row: NonNullable<ReturnType<typeof mapEnhetToProspect>> } =>
        Boolean(x.row)
      )

    // Flagg eksisterende prospects/kunder så «Importer» kan vise riktig tilstand.
    const orgs = mapped.map((m) => m.row.org_number)
    const admin = createAdminClient()
    const [prospectRes, companyRes] = orgs.length
      ? await Promise.all([
          admin.from("prospects").select("org_number, id").in("org_number", orgs),
          admin.from("companies").select("org_number").in("org_number", orgs),
        ])
      : [{ data: [] }, { data: [] }]

    const prospectByOrg = new Map(
      (prospectRes.data ?? []).map((r: { org_number: string | null; id: string }) => [r.org_number, r.id])
    )
    const customerOrgs = new Set((companyRes.data ?? []).map((r: { org_number: string | null }) => r.org_number))

    return NextResponse.json({
      results: mapped.map(({ row }) => ({
        orgNumber: row.org_number,
        name: row.name,
        city: row.city,
        naceDescription: row.nace_description,
        employeeCount: row.employee_count,
        hasContact: Boolean(row.email || row.phone),
        existingProspectId: prospectByOrg.get(row.org_number) ?? null,
        isCustomer: customerOrgs.has(row.org_number),
      })),
    })
  } catch (error) {
    console.error("[selger/brreg/search]", error)
    await logServerError({
      message: "Brønnøysund-søk feilet",
      error,
      level: "warning",
      source: "api",
      route: "GET /api/selger/brreg/search",
      context: { q },
    })
    return NextResponse.json({ error: "Søket feilet — prøv igjen" }, { status: 502 })
  }
}
