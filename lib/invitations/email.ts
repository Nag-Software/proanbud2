import { Resend } from 'resend';
import { logServerError } from '@/lib/errors/log';

const resend = new Resend(process.env.RESEND_API_KEY || 're_defaultkey');

/**
 * Sender invitasjons-e-posten og rapporterer ærlig om den faktisk gikk ut.
 * Kallere skal bruke returverdien til å fortelle brukeren sannheten —
 * aldri vis «Invitasjon sendt!» hvis denne returnerer false.
 */
export async function sendInvitationEmail(params: {
  email: string;
  invitationUrl: string;
  context?: Record<string, unknown>;
}): Promise<boolean> {
  const { email, invitationUrl, context } = params;
  try {
    const { error: sendError } = await resend.emails.send({
      from: 'Proanbud <post@proanbud.no>',
      to: email,
      subject: 'Du er invitert til Proanbud',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
          <h2 style="color: #2563eb;">Velkommen til Proanbud!</h2>
          <p>Du har blitt invitert til å bli med i bedriften din sin konto hos Proanbud.</p>
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
    if (sendError) {
      console.error('Invitation email rejected by Resend:', sendError);
      await logServerError({
        message: 'Invitasjons-e-post avvist av Resend',
        error: sendError,
        source: 'api',
        route: 'sendInvitationEmail',
        level: 'warning',
        context: { email, ...context },
      });
      return false;
    }
    return true;
  } catch (emailError) {
    console.error('Failed to send invitation email:', emailError);
    await logServerError({
      message: 'Kunne ikke sende invitasjons-e-post',
      error: emailError,
      source: 'api',
      route: 'sendInvitationEmail',
      level: 'warning',
      context: { email, ...context },
    });
    return false;
  }
}
