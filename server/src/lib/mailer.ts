import { config } from '../config.js';

/** Email stub: logs in dev. Plug in SES / SendGrid / Resend here for production. */
export async function sendMail(to: string, subject: string, body: string) {
  if (config.isTest) return;
  console.log(`[mail] to=${to} subject="${subject}"\n${body}\n`);
}
