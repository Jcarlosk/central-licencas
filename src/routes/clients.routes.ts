import { Router } from 'express';
import type { Context } from '../types/context.js';
import { clientCreate, clientPatch, pagination, paged, uuid } from '../utils/schemas.js';
import { ApiError } from '../utils/errors.js';
export function clientsRoutes({ db }: Context) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const [data, total] = await db.$transaction([db.client.findMany({ skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.client.count()]);
    res.json(paged(data, total, page, limit));
  });
  router.post('/', async (req, res) => { res.status(201).json({ success: true, data: await db.client.create({ data: clientCreate.parse(req.body) }) }); });
  router.get('/:id', async (req, res) => {
    const data = await db.client.findUnique({ where: { id: uuid.parse(req.params.id) } });
    if (!data) throw new ApiError(404, 'NOT_FOUND');
    res.json({ success: true, data });
  });
  router.patch('/:id', async (req, res) => { res.json({ success: true, data: await db.client.update({ where: { id: uuid.parse(req.params.id) }, data: clientPatch.parse(req.body) }) }); });
  return router;
}
