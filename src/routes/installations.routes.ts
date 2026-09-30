import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { Context } from '../types/context.js';
import { installationCreate, installationPatch, pagination, paged, uuid } from '../utils/schemas.js';
import { installationSelect, lockInstallation } from '../repositories/database.js';
import { newSecret, hashSecret } from '../utils/secrets.js';
import { ApiError } from '../utils/errors.js';
export function installationsRoutes({ db }: Context) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { page, limit } = pagination.parse(req.query);
    const [data, total] = await db.$transaction([db.installation.findMany({ select: installationSelect, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }), db.installation.count()]);
    res.json(paged(data, total, page, limit));
  });
  router.post('/', async (req, res) => {
    const input = installationCreate.parse(req.body);
    const installationSecret = newSecret();
    const data = await db.$transaction(async tx => {
      const installation = await tx.installation.create({ data: { ...input, installationId: input.installationId ?? `INST-${randomUUID()}`, secretHash: hashSecret(installationSecret) }, select: installationSelect });
      await tx.licenseEvent.create({ data: { installationId: installation.id, type: 'INSTALLATION_CREATED', description: 'Instalação criada', metadata: { adminId: res.locals.adminId as string } } });
      return installation;
    });
    res.status(201).json({ success: true, data, installationId: data.installationId, installationSecret });
  });
  router.get('/:id', async (req, res) => {
    const data = await db.installation.findUnique({ where: { id: uuid.parse(req.params.id) }, select: installationSelect });
    if (!data) throw new ApiError(404, 'NOT_FOUND');
    res.json({ success: true, data });
  });
  router.patch('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = installationPatch.parse(req.body);
    const data = await db.$transaction(async tx => {
      await lockInstallation(tx, id);
      return tx.installation.update({ where: { id }, data: input, select: installationSelect });
    });
    res.json({ success: true, data });
  });
  return router;
}
