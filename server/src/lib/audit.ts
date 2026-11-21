import { prisma } from '../db.js';

export async function audit(actorId: string, action: string, entity: string, entityId?: string, meta?: unknown) {
  await prisma.auditLog.create({
    data: { actorId, action, entity, entityId, meta: meta ? JSON.stringify(meta).slice(0, 2000) : null },
  });
}
