import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY || 're_defaultkey');

export async function POST(request: Request) {
  try {
    const { email, role_ids, project_ids } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    let invitedBy = user?.id;
    let companyId = null;

    if (invitedBy) {
       const { data: dbUser } = await supabase.from('users').select('company_id').eq('id', invitedBy).single();
       if (dbUser) companyId = dbUser.company_id;
    }

    if (!companyId || !invitedBy) {
      console.log("No companyId or invitedBy. invitedBy:", invitedBy, "companyId:", companyId);
      return NextResponse.json({ error: 'Brukeren må tilhøre en bedrift for å kunne invitere andre.', details: {invitedBy, companyId} }, { status: 403 });
    }

    // Generer et 32-bytes kryptografisk sikkert token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Sett inn i databasen
    const { data: invitation, error: inviteError } = await supabase
      .from('invitations')
      .insert({
        company_id: companyId,
        invited_by: invitedBy,
        email,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString()
      })
      .select()
      .single();

    if (inviteError) {
      console.error("Invite error:", inviteError);
      return NextResponse.json({ error: 'Kunne ikke opprette invitasjon' }, { status: 500 });
    }

    // Håndter roller (klienten sender inn rollenavn i array, f.eks ["Håndverker"])
    if (role_ids && role_ids.length > 0) {
       const { data: roles } = await supabase
         .from('roles')
         .select('id')
         .in('name', role_ids);

       if (roles && roles.length > 0) {
          const roleInserts = roles.map(r => ({ invitation_id: invitation.id, role_id: r.id }));
          await supabase.from('invitation_roles').insert(roleInserts);
       }
    }

    // 5. Generer URL som egentlig skal sendes på e-post
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const invitationUrl = `${baseUrl}/signup?invite=${rawToken}`;
    
    // Send invitasjon på e-post via Resend
    try {
      await resend.emails.send({
        from: 'Proanbud <onboarding@resend.dev>', // Bruk en verifisert sending-adresse senere (f.eks info@proanbud.no)
        to: email, // I test-modus med resend.dev vil denne bare kunne sende til deg (hittil du setter opp domene) 
        subject: 'Du er invitert til Proanbud',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
            <h2 style="color: #2563eb;">Velkommen til Proanbud!</h2>
            <p>Du har blitt invitert til å delta i et bedriftsworkspace hos Proanbud.</p>
            <p>Klikk på knappen nedenfor for å akseptere invitasjonen og opprette en brukerprofil.</p>
            <div style="margin: 30px 0;">
              <a href="${invitationUrl}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Aksepter invitasjon</a>
            </div>
            <p style="font-size: 14px; color: #666;">Hvis knappen ikke fungerer, kan du kopiere og lime inn denne lenken i nettleseren din:</p>
            <p style="font-size: 14px; word-break: break-all; color: #666;"><a href="${invitationUrl}">${invitationUrl}</a></p>
            <p style="margin-top: 40px; font-size: 12px; color: #999;">Dette er en automatisk generert e-post. Vennligst ikke svar på den.</p>
          </div>
        `,
      });
      console.log(`Email sent successfully to ${email}`);
    } catch (emailError) {
      console.error("Failed to send email:", emailError);
      // We still return 201 because the database invite was generated
      // The user can optionally copy it from the UI.
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Invitation sent successfully',
      invitationUrl, // Kun for test
      expiresAt 
    }, { status: 201 });

  } catch (error) {
    console.error('Error generating invitation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
