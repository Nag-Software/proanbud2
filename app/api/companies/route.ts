import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { assignUserRole, ensureCompanyRoles } from '@/lib/company-roles'
import { ensureCompanyBillingRow } from '@/lib/billing/sync'
import { logServerError } from '@/lib/errors/log'

export async function POST(request: Request) {
  try {
    const serverSupabase = await createServerSupabase()
    const { data: userData } = await serverSupabase.auth.getUser()
    const user = userData?.user
    if (!user) return NextResponse.json({ error: 'Du er ikke logget inn.' }, { status: 401 })

    const { name, org_number, full_name, phone, website } = await request.json()

    if (!name) return NextResponse.json({ error: 'Navn på bedrift mangler.' }, { status: 400 })

    const normalizedPhone = String(phone ?? '').trim()
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Telefonnummer er påkrevd.' }, { status: 400 })
    }

    // Sjekker om nøkkel eksisterer FOR å avverge tomromsfeil:
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Serverkonfigurasjon mangler (SERVICE_ROLE_KEY).' }, { status: 500 })
    }

    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // Guard against re-homing: a user who already belongs to a company must not be
    // able to create a new one. Doing so would detach them from their old company
    // (assignUserRole wipes their old user_roles), potentially leave that company
    // without an admin, and bypass the onboarding/subscription gate. Checked BEFORE
    // the company insert so we never leave an orphan company row behind.
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('company_id')
      .eq('id', user.id)
      .maybeSingle()

    if (existingUser?.company_id) {
      return NextResponse.json(
        { error: 'Du tilhører allerede en bedrift. Logg ut og opprett en ny konto for å registrere en ny bedrift.' },
        { status: 409 }
      )
    }

    // Bypass RLS og lag bedrift med admin:
    let { data: companyData, error: companyError } = await supabaseAdmin
      .from('companies')
      .insert({
        name,
        org_number: org_number || null,
        phone: normalizedPhone,
        website: website?.trim() || null,
        email: user.email || null,
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (companyError) {
      console.error('Company create error i ruten:', companyError)
      if (companyError.code === '23505') {
        return NextResponse.json({ error: 'En bedrift med dette organisasjonsnummeret eksisterer allerede.' }, { status: 400 })
      }
      // Hvis API returnerer Permission denied ETTER dette, er det feil service key eller table structure!
      return NextResponse.json({ error: 'Kunne ikke opprette bedrift: ' + JSON.stringify(companyError) }, { status: 500 })
    }

    // Lagre brukertilknytning
    const { error: userError } = await supabaseAdmin
      .from('users')
      .upsert({
        id: user.id,
        email: user.email,
        company_id: companyData.id,
        full_name: full_name || user.user_metadata?.full_name || 'Ny Bruker',
        role: 'admin' // Gir brukeren admin-rolle i sin nye bedrift (første person inn i en bedrift er admin!)
      })

    if (userError) {
      console.error('Upsert public.users error i ruten:', userError)
      return NextResponse.json({ error: 'Kunne ikke knytte bruker til bedrift: ' + JSON.stringify(userError) }, { status: 500 })
    }

    try {
      await ensureCompanyRoles(supabaseAdmin, companyData.id)
      await assignUserRole(supabaseAdmin, {
        userId: user.id,
        companyId: companyData.id,
        roleName: 'Administrator',
      })
    } catch (roleSetupError) {
      console.error('Role setup error:', roleSetupError)
      // TODO: role setup failure leaves the new admin without a role row; currently
      // swallowed and still returns success. Logged so it is visible; control flow unchanged.
      await logServerError({
        message: 'Kunne ikke sette opp roller for ny bedrift',
        error: roleSetupError,
        source: 'api',
        route: 'POST /api/companies',
        context: { companyId: companyData.id, userId: user.id },
      })
    }

    try {
      await ensureCompanyBillingRow(companyData.id)
    } catch (billingSetupError) {
      console.error('Billing setup error:', billingSetupError)
      await logServerError({
        message: 'Kunne ikke opprette billing-rad for ny bedrift',
        error: billingSetupError,
        source: 'api',
        route: 'POST /api/companies',
        level: 'warning',
        context: { companyId: companyData.id, userId: user.id },
      })
    }

    // Close the outbound loop: if this company was a prospect, mark it converted.
    if (org_number) {
      try {
        await supabaseAdmin
          .from('prospects')
          .update({
            status: 'kunde',
            matched_company_id: companyData.id,
            is_existing_customer: true,
            updated_at: new Date().toISOString(),
          })
          .eq('org_number', org_number)
      } catch (prospectError) {
        console.error('Prospect conversion update error:', prospectError)
        await logServerError({
          message: 'Kunne ikke markere prospect som konvertert',
          error: prospectError,
          source: 'api',
          route: 'POST /api/companies',
          level: 'warning',
          context: { companyId: companyData.id, userId: user.id, orgNumber: org_number },
        })
      }
    }

    return NextResponse.json({ success: true, company: companyData }, { status: 201 })
  } catch (err: any) {
    console.error('SERVER ROUTE ERROR:', err)
    await logServerError({
      message: 'Uventet feil ved opprettelse av bedrift',
      error: err,
      source: 'api',
      route: 'POST /api/companies',
    })
    return NextResponse.json({ error: 'Intern serverfeil: ' + err.message }, { status: 500 })
  }
}