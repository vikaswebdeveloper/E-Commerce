import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('Content-Security-Policy (server/vercel.json)', () => {
  const vercel = JSON.parse(read('../../server/vercel.json'));
  const csp: string = vercel.headers
    .flatMap((h: any) => h.headers)
    .find((h: any) => h.key === 'Content-Security-Policy').value;

  it('allows the inline theme script by hash: edit the script and this fails until the hash is updated', () => {
    const inline = read('../index.html').match(/<script>([\s\S]*?)<\/script>/)![1];
    const hash = `'sha256-${createHash('sha256').update(inline).digest('base64')}'`;
    expect(csp).toContain(hash);
  });

  it('does not allow arbitrary script sources or inline/eval scripts', () => {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval|\*(?!\.)|https:\s|http:/);
    expect(scriptSrc).toContain('https://checkout.razorpay.com'); // Razorpay Checkout needs this
  });

  it('forbids framing, plugins and foreign form posts', () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
  });
});
