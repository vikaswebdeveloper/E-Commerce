import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const withKey = () => {
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
  vi.stubEnv('MAIL_FROM', 'Shop <orders@example.com>');
};

describe('mailer (Resend)', () => {
  it('sends plain-text mail with the API key and never as HTML', async () => {
    withKey();
    fetchMock.mockResolvedValue({ ok: true });
    const { sendMail } = await import('../src/lib/mailer.js');
    expect(await sendMail('buyer@example.com', 'Hello', '<b>hi</b> & stuff')).toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: 'Shop <orders@example.com>', to: ['buyer@example.com'], subject: 'Hello', text: '<b>hi</b> & stuff' });
    expect(body).not.toHaveProperty('html'); // user-supplied text can never be interpreted as markup
  });

  it('cannot be used for header injection (CR/LF stripped from to / subject / reply-to)', async () => {
    withKey();
    fetchMock.mockResolvedValue({ ok: true });
    const { sendMail } = await import('../src/lib/mailer.js');
    await sendMail('a@example.com\r\nBcc: evil@example.com', 'Subject\r\nBcc: evil@example.com', 'x', { replyTo: 'r@example.com\nBcc: evil@example.com' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.stringify(body)).not.toMatch(/\\r|\\n.*Bcc|\r|\n.*Bcc/);
    expect(body.to[0]).not.toContain('\n');
    expect(body.subject).not.toContain('\n');
    expect(body.reply_to).not.toContain('\n');
  });

  it('never throws and reports failure when the mail provider is down or rejects', async () => {
    withKey();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { sendMail } = await import('../src/lib/mailer.js');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 });
    expect(await sendMail('a@example.com', 's', 't')).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await sendMail('a@example.com', 's', 't')).toBe(false);
  });

  it('does nothing (and does not call out) when no key is configured', async () => {
    const { sendMail } = await import('../src/lib/mailer.js');
    expect(await sendMail('a@example.com', 's', 't')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('contact form', () => {
  const boot = async (env: Record<string, string> = {}) => {
    withKey();
    vi.stubEnv('SUPPORT_EMAIL', 'support@example.com');
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const { createApp } = await import('../src/app.js');
    const request = (await import('supertest')).default;
    return request(createApp());
  };
  const msg = { name: 'Asha Rao', email: 'asha@example.com', message: 'Where is my order? It is late.' };

  it('delivers the message to support with the visitor as reply-to', async () => {
    const api = await boot();
    fetchMock.mockResolvedValue({ ok: true });
    const res = await api.post('/api/contact').send(msg);
    expect(res.status).toBe(200);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual(['support@example.com']);
    expect(body.reply_to).toBe('asha@example.com');
    expect(body.text).toContain('Where is my order');
  });

  it('strips HTML from the message and rejects invalid input', async () => {
    const api = await boot();
    fetchMock.mockResolvedValue({ ok: true });
    await api.post('/api/contact').send({ ...msg, message: '<script>steal()</script>Please call me back' }).expect(200);
    // (the "From: Name <email>" header line legitimately has angle brackets; the visitor's message must not)
    const messagePart = JSON.parse(fetchMock.mock.calls[0][1].body).text.split('\n\n').slice(1).join('\n\n');
    expect(messagePart).toBe('steal()Please call me back');
    for (const bad of [{ ...msg, email: 'nope' }, { ...msg, message: 'short' }, { ...msg, name: '' }, { ...msg, message: 'x'.repeat(2001) }]) {
      expect((await api.post('/api/contact').send(bad)).status).toBe(400);
    }
  });

  it('silently ignores bots that fill the honeypot field (no email is sent)', async () => {
    const api = await boot();
    const res = await api.post('/api/contact').send({ ...msg, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is rate limited to stop mail flooding', async () => {
    const api = await boot({ CONTACT_RATE_LIMIT: '2' });
    fetchMock.mockResolvedValue({ ok: true });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await api.post('/api/contact').send(msg)).status);
    expect(codes).toEqual([200, 200, 429, 429]);
  });

  it('reports 502 when email cannot be sent and 503 when contact is not configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const api = await boot();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect((await api.post('/api/contact').send(msg)).status).toBe(502);

    vi.resetModules();
    vi.unstubAllEnvs();
    const { createApp } = await import('../src/app.js');
    const request = (await import('supertest')).default;
    expect((await request(createApp()).post('/api/contact').send(msg)).status).toBe(503);
  });
});
