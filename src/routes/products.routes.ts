import { Router } from 'express';
import type { Context } from '../types/context.js';
import { productCreate, productPatch, pagination, paged, uuid } from '../utils/schemas.js';
import { ApiError } from '../utils/errors.js';
export function productsRoutes({ db }: Context) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const [data, total] = await db.$transaction([db.product.findMany({ skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.product.count()]);
    res.json(paged(data, total, page, limit));
  });
  router.post('/', async (req, res) => { res.status(201).json({ success: true, data: await db.product.create({ data: productCreate.parse(req.body) }) }); });
  router.get('/:id', async (req, res) => {
    const data = await db.product.findUnique({ where: { id: uuid.parse(req.params.id) } });
    if (!data) throw new ApiError(404, 'NOT_FOUND');
    res.json({ success: true, data });
  });
  router.patch('/:id', async (req, res) => { res.json({ success: true, data: await db.product.update({ where: { id: uuid.parse(req.params.id) }, data: productPatch.parse(req.body) }) }); });
  return router;
}
