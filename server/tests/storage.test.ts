import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake the S3 SDK so no network call is ever made. Each command records its type and input.
const { send, S3Client, cmd } = vi.hoisted(() => {
  const send = vi.fn();
  const cmd = (kind: string) =>
    vi.fn(function (this: any, input: unknown) {
      this.kind = kind;
      this.input = input;
    });
  return {
    send,
    S3Client: vi.fn(function (this: any) {
      this.send = send;
    }),
    cmd,
  };
});
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client,
  PutObjectCommand: cmd('put'),
  DeleteObjectCommand: cmd('delete'),
  ListObjectsV2Command: cmd('listObjects'),
  ListObjectVersionsCommand: cmd('listVersions'),
}));

const B2 = { B2_KEY_ID: 'keyid', B2_APPLICATION_KEY: 'appkey', B2_BUCKET: 'my-shop', B2_REGION: 'us-west-004', B2_PUBLIC_URL: '' };
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const NAME = '11111111-2222-3333-4444-555555555555.png';
const sent = () => send.mock.calls.map((c) => c[0] as { kind: string; input: any });

beforeEach(() => {
  vi.resetModules();
  send.mockReset();
  S3Client.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

const useB2 = () => {
  for (const [k, v] of Object.entries(B2)) vi.stubEnv(k, v);
};

describe('Backblaze B2 image storage', () => {
  it('uploads to the configured bucket with a server-generated key and returns the public URL', async () => {
    useB2();
    send.mockResolvedValue({});
    const { saveImage } = await import('../src/services/storage.js');
    const url = await saveImage(png, 'png');

    expect(url).toMatch(/^https:\/\/my-shop\.s3\.us-west-004\.backblazeb2\.com\/products\/[0-9a-f-]{36}\.png$/);
    const put = sent()[0];
    expect(put.kind).toBe('put');
    expect(put.input).toMatchObject({ Bucket: 'my-shop', ContentType: 'image/png' });
    expect(put.input.Key).toMatch(/^products\/[0-9a-f-]{36}\.png$/);
    // B2 compatibility: SDK must not send CRC32 checksum headers.
    expect((S3Client.mock.calls[0] as any[])[0]).toMatchObject({
      endpoint: 'https://s3.us-west-004.backblazeb2.com',
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  });

  it('uses B2_PUBLIC_URL (CDN / custom domain) when provided, without a trailing slash', async () => {
    useB2();
    vi.stubEnv('B2_PUBLIC_URL', 'https://cdn.example.com/');
    send.mockResolvedValue({});
    const { saveImage } = await import('../src/services/storage.js');
    expect(await saveImage(png, 'webp')).toMatch(/^https:\/\/cdn\.example\.com\/products\/[0-9a-f-]{36}\.webp$/);
  });

  it('returns a clean 502 (and leaks nothing) when B2 is down', async () => {
    useB2();
    send.mockRejectedValue(new Error('SignatureDoesNotMatch secret=abc'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { saveImage } = await import('../src/services/storage.js');
    await expect(saveImage(png, 'png')).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining('secret') });
  });

  it('falls back to local disk when B2 is not configured (dev only)', async () => {
    const fs = await import('node:fs');
    const { saveImage, UPLOAD_DIR } = await import('../src/services/storage.js');
    const url = await saveImage(png, 'png');
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]{36}\.png$/);
    expect(send).not.toHaveBeenCalled();
    fs.rmSync(`${UPLOAD_DIR}/${url.split('/').pop()}`, { force: true });
  });

  it('refuses to boot in production without B2 (local disk is ephemeral)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
    await expect(import('../src/config.js')).rejects.toThrow(/Backblaze B2 is required/);
  });
});

describe('deleting images from B2', () => {
  it('deletes EVERY version and hide-marker of the file (B2 keeps old versions otherwise)', async () => {
    useB2();
    const key = `products/${NAME}`;
    send.mockImplementation(async (c: any) =>
      c.kind === 'listVersions'
        ? { Versions: [{ Key: key, VersionId: 'v2' }, { Key: key, VersionId: 'v1' }, { Key: `${key}.bak`, VersionId: 'other' }], DeleteMarkers: [{ Key: key, VersionId: 'm1' }] }
        : {},
    );
    const { deleteStoredImage } = await import('../src/services/storage.js');
    expect(await deleteStoredImage(`https://my-shop.s3.us-west-004.backblazeb2.com/products/${NAME}`)).toBe(true);

    const deletes = sent().filter((c) => c.kind === 'delete').map((c) => c.input);
    expect(deletes.map((d) => d.VersionId).sort()).toEqual(['m1', 'v1', 'v2']); // not "other"
    expect(deletes.every((d) => d.Key === key && d.Bucket === 'my-shop')).toBe(true);
  });

  it('falls back to a plain delete on an unversioned bucket', async () => {
    useB2();
    send.mockResolvedValue({});
    const { deleteStoredImage } = await import('../src/services/storage.js');
    await deleteStoredImage(`https://my-shop.s3.us-west-004.backblazeb2.com/products/${NAME}`);
    expect(sent().filter((c) => c.kind === 'delete')).toHaveLength(1);
  });

  it.each([
    'https://picsum.photos/seed/x/800/800', // seed/demo images live elsewhere
    'https://evil.example.com/products/' + NAME, // not our bucket URL
    `https://my-shop.s3.us-west-004.backblazeb2.com/products/../secret.png`, // traversal
    `https://my-shop.s3.us-west-004.backblazeb2.com/other/${NAME}`, // not under products/
    `https://my-shop.s3.us-west-004.backblazeb2.com/products/notauuid.png`,
    '/uploads/../../etc/passwd',
    '',
  ])('never deletes anything for %s', async (url) => {
    useB2();
    const { deleteStoredImage } = await import('../src/services/storage.js');
    expect(await deleteStoredImage(url)).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('swallows storage errors so an admin action never fails because of cleanup', async () => {
    useB2();
    send.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deleteStoredImage } = await import('../src/services/storage.js');
    await expect(deleteStoredImage(`https://my-shop.s3.us-west-004.backblazeb2.com/products/${NAME}`)).resolves.toBe(false);
  });

  it('lists stored images across pages for the orphan sweep', async () => {
    useB2();
    const n2 = '22222222-2222-3333-4444-555555555555.jpg';
    send
      .mockResolvedValueOnce({ Contents: [{ Key: `products/${NAME}`, LastModified: new Date(1000) }], IsTruncated: true, NextContinuationToken: 't' })
      .mockResolvedValueOnce({ Contents: [{ Key: `products/${n2}`, LastModified: new Date(2000) }, { Key: 'products/junk.txt', LastModified: new Date() }], IsTruncated: false });
    const { listStoredImages } = await import('../src/services/storage.js');
    const all = await listStoredImages();
    expect(all.map((a) => a.name)).toEqual([NAME, n2]);
    expect(sent()[1].input.ContinuationToken).toBe('t');
  });
});
