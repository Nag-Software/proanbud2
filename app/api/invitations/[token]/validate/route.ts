import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const supabaseAdmin = createAdminClient();

    const { data: invitation, error } = await supabaseAdmin
      .from('invitations')
      .select(`
        id,
        email,
        status,
        expires_at,
        company_id,
        companies:company_id (name)
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (error || !invitation) {
      return NextResponse.json({ error: 'Ugyldig invitasjon' }, { status: 404 });
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: 'Invitasjonen er allerede brukt eller trukket tilbake' }, { status: 400 });
    }

    if (new Date() > new Date(invitation.expires_at)) {
      return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 400 });
    }

    const company = Array.isArray(invitation.companies)
      ? invitation.companies[0]
      : invitation.companies;

    return NextResponse.json({
      valid: true,
      email: invitation.email,
      companyName: company?.name || 'Bedrift',
    }, { status: 200 });
  } catch (error) {
    console.error('Error validating invitation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
