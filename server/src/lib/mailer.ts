import { config } from '../config.js';

export type Mail = { to: string; subject: string; text: string; replyTo?: string };

/** Strip CR/LF so a value can never smuggle extra headers into a message. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, 200);

/**
 * Sends a plain-text email through Resend (https://resend.com). Plain text on purpose: user-supplied
 * values (names, messages) can never be interpreted as HTML.
 *
 * Never throws: a mail outage must not break checkout or signup. Returns whether the mail was accepted.
 * Without RESEND_API_KEY the mail is only logged (development) and `false` is returned.
 */
export async function sendMail(to: string, subject: string, text: string, opts: { replyTo?: string } = {}): Promise<boolean> {
  if (config.isTest && !config.mail.resendKey) return false;

  if (!config.mail.resendKey || !config.mail.from) {
    if (!config.isProd) console.log(`[mail:not-sent] to=${to} subject="${subject}"\n${text}\n`);
    else console.warn('[mail] RESEND_API_KEY / MAIL_FROM not set: email not sent');
    return false;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.mail.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: config.mail.from,
        to: [oneLine(to)],
        subject: oneLine(subject),
        text,
        ...(opts.replyTo ? { reply_to: oneLine(opts.replyTo) } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`[mail] Resend rejected the message (${res.status})`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[mail] send failed', (e as Error).message);
    return false;
  }
}
