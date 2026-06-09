import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { assignUserRole } from '@/lib/company-roles';
import { ROLE_DB_VALUES, normalizeRole, roleNameToDisplay } from '@/lib/roles';

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createAdminClient();
    const { token, fullName = "Ny Ansatt", password, email } = await request.json();

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

    const targetEmail = (email || invite.email).trim().toLowerCase();

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
    }

    await supabaseAdmin
      .from('invitations')
      .update({ status: 'accepted' })
      .eq('id', invite.id);

    return NextResponse.json({
      success: true,
      message: 'Bruker registrert og tilgang tildelt',
      userId: newUserId
    }, { status: 201 });

  } catch (error) {
    console.error('Error during registration:', error);
    return NextResponse.json({ error: 'Intern serverfeil' }, { status: 500 });
  }
}
