import { prisma } from '../db.js';
import { deleteStoredImage, imageName, listStoredImages, ownedImage } from './storage.js';
import { parseImages } from '../lib/validate.js';

/**
 * Called after an image stops being used by a product (removed in an edit, product deleted,
 * or an upload that was never saved). Deletes the file from storage unless some product still uses it,
 * and clears it from past order snapshots so no order points at a dead link.
 */
export async function releaseImages(urls: string[]): Promise<number> {
  let removed = 0;
  for (const url of [...new Set(urls)]) {
    if (!ownedImage(url)) continue; // foreign URLs (picsum, other CDNs) are never ours to delete
    const name = imageName(url);
    if (!name) continue;
    const stillUsed = await prisma.product.findFirst({ where: { images: { contains: name } }, select: { id: true } });
    if (stillUsed) continue;
    await prisma.orderItem.updateMany({ where: { image: { contains: name } }, data: { image: null } });
    if (await deleteStoredImage(url)) removed++;
  }
  return removed;
}

/**
 * Safety net: removes stored images that no product references (e.g. an admin closed the browser
 * mid-upload). Skips very recent uploads, and refuses to run against an empty product table so a
 * mis-pointed database can never wipe the bucket.
 */
export async function sweepOrphanImages(opts: { minAgeMs?: number; maxDeletes?: number } = {}) {
  const minAgeMs = opts.minAgeMs ?? 60 * 60_000;
  const maxDeletes = opts.maxDeletes ?? 200;

  if ((await prisma.product.count()) === 0) return { scanned: 0, deleted: 0, skipped: 'no products in database' as const };

  const referenced = new Set<string>();
  for (const p of await prisma.product.findMany({ select: { images: true } })) {
    for (const u of parseImages(p.images)) {
      const n = imageName(u);
      if (n) referenced.add(n);
    }
  }

  const stored = await listStoredImages();
  let deleted = 0;
  for (const s of stored) {
    if (referenced.has(s.name)) continue;
    if (Date.now() - s.lastModified.getTime() < minAgeMs) continue;
    if (deleted >= maxDeletes) break;
    await prisma.orderItem.updateMany({ where: { image: { contains: s.name } }, data: { image: null } });
    if (await deleteStoredImage(s.url)) deleted++;
  }
  return { scanned: stored.length, deleted, skipped: null };
}
