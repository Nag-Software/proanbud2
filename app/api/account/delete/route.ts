import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"

/**
 * Slett egen konto (App Review 5.1.1(v): apper med registrering MÅ tilby
 * kontosletting i appen).
 *
 * «Sletting» = anonymisering + stengt innlogging, IKKE hard delete:
 *   • time_entries har ON DELETE CASCADE mot users — hard sletting ville
 *     radert bedriftens timeføring (bokføringspliktige fakturagrunnlag).
 *   • kjorebok_trips/deviations/project_checklists har RESTRICT — hard
 *     sletting feiler uansett for alle med reell aktivitet.
 *   • GDPR art. 17(3)(b) tillater å beholde lovpålagte regnskapsdata; raden
 *     som blir igjen er pseudonymisert og uten persondata.
 *
 * Stegene (minst irreversible først, innlogging stenges til slutt):
 *   1. Guard: siste aktive admin i en bedrift med andre aktive medlemmer kan
 *      ikke slette seg selv — bedriften ville stått uten administrator.
 *   2. user_profiles-raden slettes (avatar, bio).
 *   3. public.users anonymiseres (navn/e-post → tombstone, is_active=false).
 *   4. auth-brukeren gjøres ubrukelig: e-post → tombstone (frigjør adressen
 *      for ny registrering), nytt tilfeldig passord, metadata tømmes, og
 *      kontoen bannes i 100 år (banned_until blokkerer token-refresh).
 */
export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Ikke innlogget." }, { status: 401 })
    }

    const admin = createAdminClient()

    const { data: userRow, error: rowError } = await admin
      .from("users")
      .select("company_id, role, is_active")
      .eq("id", user.id)
      .maybeSingle()
    if (rowError) throw rowError

    // Siste admin-guard — kun relevant når brukeren faktisk er i en bedrift.
    if (userRow?.company_id && userRow.role === "admin") {
      const { data: others, error: othersError } = await admin
        .from("users")
        .select("id, role")
        .eq("company_id", userRow.company_id)
        .eq("is_active", true)
        .neq("id", user.id)
      if (othersError) throw othersError

      const hasOtherMembers = (others?.length ?? 0) > 0
      const hasOtherAdmin = (others ?? []).some((u) => u.role === "admin")
      if (hasOtherMembers && !hasOtherAdmin) {
        return NextResponse.json(
          {
            error:
              "Du er eneste administrator i bedriften. Gi administratorrollen til et annet medlem før du sletter kontoen.",
          },
          { status: 409 }
        )
      }
    }

    const tombstoneEmail = `slettet-${user.id}@slettet.proanbud.no`

    const { error: profileError } = await admin
      .from("user_profiles")
      .delete()
      .eq("user_id", user.id)
    if (profileError) throw profileError

    if (userRow) {
      const { error: anonError } = await admin
        .from("users")
        .update({
          full_name: "Slettet bruker",
          email: tombstoneEmail,
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id)
      if (anonError) throw anonError
    }

    const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
      email: tombstoneEmail,
      email_confirm: true,
      password: crypto.randomUUID() + crypto.randomUUID(),
      user_metadata: {},
      ban_duration: "876000h",
    })
    if (authError) throw authError

    // Rydd innloggingskakene i denne nettleseren. Banningen over har allerede
    // stengt refresh for alle andre enheter.
    await supabase.auth.signOut()

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("Account delete failed:", e)
    await logServerError({
      message: "Account delete failed",
      error: e,
      source: "api",
      route: "POST /api/account/delete",
    })
    return NextResponse.json(
      { error: "Kunne ikke slette kontoen. Prøv igjen, eller kontakt post@proanbud.no." },
      { status: 500 }
    )
  }
}
