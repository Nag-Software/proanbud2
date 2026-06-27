import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignUserRole } from '@/lib/company-roles';
import { ROLE_DB_VALUES, normalizeRole, roleNameToDisplay } from '@/lib/roles';
import { logServerError } from '@/lib/errors/log';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createAdminClient();
    const { token, fullName = "Ny Ansatt", password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { data: invite, error: inviteError } = await supabaseAdmin
      .from('invitations')
      .select('*')
      .eq('token_hash', tokenHash)
      .eq('status', 'pending')
      .single();

    if (inviteError || !invite) {
      return NextResponse.json({ error: 'Ugyldig eller utløpt invitasjonslenke' }, { status: 400 });
    }

    if (new Date() > new Date(invite.expires_at)) {
      return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 400 });
    }

    // Always bind to the invitation's email — never trust a client-supplied address
    // (prevents creating a confirmed account / joining a company on an arbitrary email).
    const targetEmail = String(invite.email).trim().toLowerCase();

    const { data: authRecord, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: targetEmail,
      password: password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });

    if (authError) {
       console.error('Auth error:', authError);
       return NextResponse.json({ error: 'Kunne ikke opprette bruker: ' + authError.message }, { status: 500 });
    }

    const newUserId = authRecord.user.id;

    const { data: inviteRoles } = await supabaseAdmin
      .from('invitation_roles')
      .select('role_id, roles(name)')
      .eq('invitation_id', invite.id);

    const invitedRoleName =
      // @ts-expect-error Supabase nested relation typing
      inviteRoles?.[0]?.roles?.name || 'Håndverker';
    const canonicalRole = normalizeRole(invitedRoleName) || 'worker';

    const { error: userError } = await supabaseAdmin.from('users').insert({
      id: newUserId,
      email: targetEmail,
      full_name: fullName,
      company_id: invite.company_id,
      role: ROLE_DB_VALUES[canonicalRole],
      is_active: true
    });

    if (userError) {
       console.error('Insert user error:', userError);
       return NextResponse.json({ error: 'Kunne ikke opprette brukerprofil' }, { status: 500 });
    }

    try {
      await assignUserRole(supabaseAdmin, {
        userId: newUserId,
        companyId: invite.company_id,
        roleName: roleNameToDisplay(canonicalRole),
      });
    } catch (roleError) {
      console.error('Assign role error:', roleError);
      await logServerError({
        message: 'Failed to assign role to invited user',
        error: roleError,
        source: 'api',
        route: 'POST /api/auth/register-invited',
        companyId: invite.company_id,
        userId: newUserId,
      });
    }

    await supabaseAdmin
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invite.id);

    try {
      const { syncSeatQuantity } = await import('@/lib/billing/sync');
      await syncSeatQuantity(invite.company_id);
    } catch (seatSyncError) {
      console.error('Seat sync error after invite:', seatSyncError);
      await logServerError({
        message: 'Seat sync failed after invite acceptance',
        error: seatSyncError,
        source: 'api',
        route: 'POST /api/auth/register-invited',
        level: 'warning',
        companyId: invite.company_id,
        userId: newUserId,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Bruker registrert og tilgang tildelt',
      userId: newUserId
    }, { status: 201 });

  } catch (error) {
    console.error('Error during registration:', error);
    await logServerError({
      message: 'Invited-user registration failed',
      error,
      source: 'api',
      route: 'POST /api/auth/register-invited',
    });
    return NextResponse.json({ error: 'Intern serverfeil' }, { status: 500 });
  }
}
