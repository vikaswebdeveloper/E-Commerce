import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { b2, b2Enabled, config } from '../config.js';
import { AppError } from '../lib/errors.js';

export const UPLOAD_DIR = config.uploadDir;

const CONTENT_TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
const NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

// Backblaze B2 speaks the S3 API. `WHEN_REQUIRED` avoids the newer SDK's default CRC32 checksum
// headers, which B2 does not accept.
const s3 = b2Enabled
  ? new S3Client({
      region: b2.region,
      endpoint: b2.endpoint,
      credentials: { accessKeyId: b2.keyId, secretAccessKey: b2.appKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  : null;

/**
 * Stores an already-validated image and returns the URL the browser should use.
 * The object key is always server-generated (never derived from user input).
 */
export async function saveImage(buffer: Buffer, ext: keyof typeof CONTENT_TYPE): Promise<string> {
  const name = `${crypto.randomUUID()}.${ext}`;

  if (s3) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: b2.bucket,
          Key: `products/${name}`,
          Body: buffer,
          ContentType: CONTENT_TYPE[ext],
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (e) {
      console.error('B2 upload failed', e);
      throw new AppError(502, 'Image storage is unavailable, please try again');
    }
    return `${b2.publicBaseUrl}/products/${name}`;
  }

  // Development / test fallback.
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.writeFile(path.join(UPLOAD_DIR, name), buffer);
  return `/uploads/${name}`;
}

/** The file name (uuid.ext) of an image WE stored, or null for any foreign URL (picsum, other CDNs, ...). */
export function ownedImage(url: string): { kind: 'b2' | 'local'; name: string } | null {
  if (typeof url !== 'string') return null;
  if (url.startsWith('/uploads/')) {
    const name = url.slice('/uploads/'.length);
    return NAME_RE.test(name) ? { kind: 'local', name } : null;
  }
  if (b2Enabled && url.startsWith(`${b2.publicBaseUrl}/products/`)) {
    const name = url.slice(`${b2.publicBaseUrl}/products/`.length);
    return NAME_RE.test(name) ? { kind: 'b2', name } : null;
  }
  return null;
}

/** Last path segment if it looks like one of our uploaded files (used to compare references by name, not by host). */
export function imageName(url: string): string | null {
  const name = url.split('?')[0].split('/').pop() ?? '';
  return NAME_RE.test(name) ? name : null;
}

/**
 * Permanently removes one stored image. B2 keeps every version of a file by default, so a plain
 * delete would only hide it (and you would keep paying for it): delete every version + hide marker.
 * Returns true if something was removed. Never throws: storage hiccups must not fail an admin action.
 */
export async function deleteStoredImage(url: string): Promise<boolean> {
  const img = ownedImage(url);
  if (!img) return false;
  try {
    if (img.kind === 'local') {
      await fs.rm(path.join(UPLOAD_DIR, img.name), { force: true });
      return true;
    }
    const key = `products/${img.name}`;
    const listed = await s3!.send(new ListObjectVersionsCommand({ Bucket: b2.bucket, Prefix: key }));
    const targets = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])].filter((v) => v.Key === key && v.VersionId);
    if (targets.length === 0) {
      await s3!.send(new DeleteObjectCommand({ Bucket: b2.bucket, Key: key }));
    }
    for (const t of targets) {
      await s3!.send(new DeleteObjectCommand({ Bucket: b2.bucket, Key: key, VersionId: t.VersionId }));
    }
    return true;
  } catch (e) {
    console.error(`Failed to delete stored image ${img.name}`, e);
    return false;
  }
}

/** Everything currently stored by the active backend (B2, or local disk in development). */
export async function listStoredImages(): Promise<{ url: string; name: string; lastModified: Date }[]> {
  const out: { url: string; name: string; lastModified: Date }[] = [];
  if (s3) {
    let token: string | undefined;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: b2.bucket, Prefix: 'products/', ContinuationToken: token }));
      for (const o of r.Contents ?? []) {
        const name = (o.Key ?? '').slice('products/'.length);
        if (NAME_RE.test(name) && o.LastModified) out.push({ url: `${b2.publicBaseUrl}/products/${name}`, name, lastModified: o.LastModified });
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  try {
    for (const name of await fs.readdir(UPLOAD_DIR)) {
      if (!NAME_RE.test(name)) continue;
      const st = await fs.stat(path.join(UPLOAD_DIR, name));
      out.push({ url: `/uploads/${name}`, name, lastModified: st.mtime });
    }
  } catch {
    /* directory does not exist yet */
  }
  return out;
}
