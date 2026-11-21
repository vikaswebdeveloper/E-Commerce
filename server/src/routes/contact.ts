import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { sendMail } from '../lib/mailer.js';
import { email, parse, text } from '../lib/validate.js';
import { contactLimiter } from '../middleware/security.js';

export const contactRouter = Router();

/** Public contact form -> email to SUPPORT_EMAIL. Rate-limited; includes a honeypot field that real users never fill. */
contactRouter.post('/', contactLimiter(), async (req, res) => {
  if (!config.mail.supportEmail) throw new AppError(503, 'The contact form is not available right now');
  const b = parse(
    z.object({ name: text(80, 2), email, message: text(2000, 10), website: z.string().max(200).optional() }),
    req.body,
  );
  // Honeypot: bots fill every field. Pretend success so they learn nothing.
  if (b.website) return res.json({ ok: true });

  const sent = await sendMail(config.mail.supportEmail, `Contact form: ${b.name}`, `From: ${b.name} <${b.email}>\n\n${b.message}`, { replyTo: b.email });
  if (!sent) throw new AppError(502, 'We could not send your message right now. Please try again later.');
  res.json({ ok: true });
});
