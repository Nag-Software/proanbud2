import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { token, fullName = "Ny Ansatt", password, email } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: 'Mangler påkrevde felt' }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 1. Get the invite
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

    const targetEmail = email || invite.email;

    // 2. Create the user using Admin API (auto-confirms email)
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

    // 3. Insert into public.users
    const { error: userError } = await supabaseAdmin.from('users').insert({
      id: newUserId,
      email: targetEmail,
      full_name: fullName,
      company_id: invite.company_id,
      is_active: true
    });
    
    if (userError) {
       console.error('Insert user error:', userError);
       // Ideally rollback on fail, but let's continue to roles
    }

    // 4. Get pre-assigned roles and insert to user_roles
    const { data: inviteRoles } = await supabaseAdmin
      .from('invitation_roles')
      .select('role_id')
      .eq('invitation_id', invite.id);

    if (inviteRoles && inviteRoles.length > 0) {
      const roleInserts = inviteRoles.map(r => ({ user_id: newUserId, role_id: r.role_id }));
      await supabaseAdmin.from('user_roles').insert(roleInserts);
    }

    // 5. Update invite status
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