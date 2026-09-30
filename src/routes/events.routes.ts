import { Router } from 'express';
import { EventType, type Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Context } from '../types/context.js';
import { pagination, paged, uuid } from '../utils/schemas.js';
const filters = pagination.extend({ installationId: uuid.optional(), licenseId: uuid.optional(), type: z.enum(EventType).optional(), from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() }).strict().refine(v => !v.from || !v.to || new Date(v.from) <= new Date(v.to));
export function eventsRoutes({ db }: Context) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { page, limit, installationId, licenseId, type, from, to } = filters.parse(req.query);
    const where: Prisma.LicenseEventWhereInput = { installationId, licenseId, type, ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) };
    const [data, total] = await db.$transaction([db.licenseEvent.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.licenseEvent.count({ where })]);
    res.json(paged(data, total, page, limit));
  });
  return router;
}
