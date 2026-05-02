import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const p = await params;
    const { token } = p;

    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 });
    }

    // 1. Hash the incoming token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 2. Query the database
    // Pseudo-code:
    /*
    const invitation = await db.invitations.findUnique({
      where: { token_hash: tokenHash },
      include: { company: true }
    });

    if (!invitation) {
      return NextResponse.json({ error: 'Ugyldig invitasjon' }, { status: 404 });
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: 'Invitasjonen er allerede brukt eller trukket tilbake' }, { status: 400 });
    }

    if (new Date() > new Date(invitation.expires_at)) {
      return NextResponse.json({ error: 'Invitasjonen har utløpt' }, { status: 400 });
    }
    */

    // Return mock success for valid token
    return NextResponse.json({ 
      valid: true,
      email: 'mock-invited-user@bedrift.no',
      companyName: 'Mock Bedrift AS'
    }, { status: 200 });

  } catch (error) {
    console.error('Error validating invitation:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
