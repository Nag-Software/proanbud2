import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canInviteEmployees, normalizeRole } from '@/lib/roles';
import { ensureCompanyRoles, resolveRoleNamesForCompany } from '@/lib/company-roles';
import { sendInvitationEmail } from '@/lib/invitations/email';
import { logServerError } from '@/lib/errors/log';

export async function POST(request: Request) {
  try {
    const { email, role_ids, project_ids } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'E-post er påkrevd' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Du må være logget inn' }, { status: 401 });
    }

    const { data: dbUser, error: dbUserError } = await supabase
      .from('users')
      .select('company_id, role')
      .eq('id', user.id)
      .single();

    if (dbUserError || !dbUser?.company_id) {
      return NextResponse.json(
        { error: 'Brukeren må tilhøre en bedrift for å kunne invitere andre.' },
        { status: 403 }
      );
    }

    const { data: userRoleData } = await supabase
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', user.id)
      .maybeSingle();

    // @ts-expect-error Supabase nested relation typing
    const effectiveRole = userRoleData?.roles?.name || dbUser.role;

    if (!canInviteEmployees(effectiveRole)) {
      return NextResponse.json(
        { error: 'Kun administratorer kan invitere ansatte.' },
        { status: 403 }
      );
    }

    const companyId = dbUser.company_id;
    const admin = createAdminClient();

    await ensureCompanyRoles(admin, companyId);

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: existingUser } = await admin
      .from('users')
      .select('id')
      .eq('company_id', companyId)
      .ilike('email', normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json({ error: 'Denne e-postadressen er allerede registrert i bedriften.' }, { status: 400 });
    }

    const { data: pendingInvite } = await admin
      .from('invitations')
      .select('id')
      .eq('company_id', companyId)
      .eq('email', normalizedEmail)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingInvite) {
      return NextResponse.json({ error: 'Det finnes allerede en ventende invitasjon for denne e-postadressen.' }, { status: 400 });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const { data: invitation, error: inviteError } = await admin
      .from('invitations')
      .insert({
        company_id: companyId,
        invited_by: user.id,
        email: normalizedEmail,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (inviteError || !invitation) {
      console.error('Invite error:', inviteError);
      await logServerError({
        message: 'Kunne ikke opprette invitasjon',
        error: inviteError,
        source: 'api',
        route: 'POST /api/invitations',
        context: { companyId, userId: user.id, email: normalizedEmail },
      });
      return NextResponse.json({ error: 'Kunne ikke opprette invitasjon' }, { status: 500 });
    }

    const requestedRoles = Array.isArray(role_ids) && role_ids.length > 0 ? role_ids : ['Håndverker'];
    const roles = await resolveRoleNamesForCompany(admin, companyId, requestedRoles);

    if (roles.length > 0) {
      const roleInserts = roles.map((role) => ({
        invitation_id: invitation.id,
        role_id: role.id,
      }));

      const { error: roleInsertError } = await admin.from('invitation_roles').insert(roleInserts);
      if (roleInsertError) {
        console.error('Invitation role error:', roleInsertError);
        await logServerError({
          message: 'Kunne ikke knytte roller til invitasjon',
          error: roleInsertError,
          source: 'api',
          route: 'POST /api/invitations',
          context: { companyId, userId: user.id, invitationId: invitation.id },
        });
      }
    }

    if (Array.isArray(project_ids) && project_ids.length > 0) {
      // Reserved for future project-scoped invites
      console.log('Project assignment on invite not yet implemented', project_ids);
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
    const invitationUrl = `${baseUrl}/signup?invite=${rawToken}`;

    const emailSent = await sendInvitationEmail({
      email: normalizedEmail,
      invitationUrl,
      context: { companyId, userId: user.id },
    });

    return NextResponse.json({
      success: true,
      emailSent,
      invitationId: invitation.id,
      message: emailSent
        ? 'Invitasjonen er sendt på e-post.'
        : 'Invitasjonen ble opprettet, men e-posten kunne ikke sendes. Del invitasjonslenken manuelt.',
      invitationUrl,
      expiresAt,
      invitedRole: requestedRoles.map((role: string) => normalizeRole(role) || role),
    }, { status: 201 });
  } catch (error) {
    console.error('Error generating invitation:', error);
    await logServerError({
      message: 'Uventet feil ved generering av invitasjon',
      error,
      source: 'api',
      route: 'POST /api/invitations',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
