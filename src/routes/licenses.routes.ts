import { Router } from 'express';
import type { Context } from '../types/context.js';
import { pagination, paged, uuid, licenseCreate, daysSchema, actionBody } from '../utils/schemas.js';
import { ApiError } from '../utils/errors.js';
import { createLicense, changeLicense } from '../services/licenses.js';
export function licensesRoutes(ctx: Context) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const [data, total] = await ctx.db.$transaction([ctx.db.license.findMany({ skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), ctx.db.license.count()]);
    res.json(paged(data, total, page, limit));
  });
  router.get('/:id', async (req, res) => {
    const data = await ctx.db.license.findUnique({ where: { id: uuid.parse(req.params.id) } });
    if (!data) throw new ApiError(404, 'NOT_FOUND');
    res.json({ success: true, data });
  });
  router.post('/', async (req, res) => { res.status(201).json({ success: true, data: await createLicense(ctx, licenseCreate.parse(req.body), res.locals.adminId as string) }); });
  router.post('/:id/renew', async (req, res) => { res.json({ success: true, data: await changeLicense(ctx, uuid.parse(req.params.id), 'renew', daysSchema.parse(req.body), res.locals.adminId as string) }); });
  for (const action of ['suspend', 'reactivate', 'revoke'] as const) {
    router.post(`/:id/${action}`, async (req, res) => { res.json({ success: true, data: await changeLicense(ctx, uuid.parse(req.params.id), action, actionBody.parse(req.body ?? {}), res.locals.adminId as string) }); });
  }
  return router;
}
