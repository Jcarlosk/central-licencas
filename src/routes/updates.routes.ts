import { Router } from 'express';
import multer from 'multer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Context } from '../types/context.js';
import { pagination, paged, uuid } from '../utils/schemas.js';
import { releaseBody, checkBody } from '../utils/update-schemas.js';
import { ApiError } from '../utils/errors.js';
import { validateAssetName, validateUpdateAssets, MAX_FILE_BYTES, type UpdateAsset } from '../services/update-files.js';
import { DryRunPublisher } from '../services/github-releases.js';
import { checkUpdates } from '../services/updates.js';

export function publicUpdatesRoutes(ctx: Context) {
  const router = Router();
  router.post('/check', async (req, res) => { res.json(await checkUpdates(ctx, checkBody.parse(req.body))); });
  return router;
}
export function updatesRoutes({ db }: Context) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { productId, ...query } = z.object({ productId: uuid.optional(), page: z.coerce.number().optional(), limit: z.coerce.number().optional() }).strict().parse(req.query);
    const { page, limit } = pagination.parse(query);
    const where = productId ? { productId } : {};
    const [data, total] = await db.$transaction([
      db.updateRelease.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      db.updateRelease.count({ where }),
    ]);
    res.json(paged(data, total, page, limit));
  });
  router.post('/', async (req, res) => {
    const input = releaseBody.parse(req.body);
    const product = await db.product.findUnique({ where: { id: input.productId } });
    if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND');
    if (!product.active) throw new ApiError(409, 'INACTIVE_ENTITY');
    const data = await db.updateRelease.create({ data: { ...input, githubTag: `v${input.version}`, createdBy: res.locals.adminId as string } });
    res.status(201).json({ success: true, data });
  });
  router.patch('/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const existing = await db.updateRelease.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND');
    const input = releaseBody.parse(req.body);
    if (input.productId !== existing.productId) throw new ApiError(400, 'PRODUCT_MISMATCH');
    // Compare-and-set: publication and editing cannot overwrite each other's state.
    const result = await db.updateRelease.updateMany({ where: { id, status: 'DRAFT', githubReleaseId: null },
      data: { ...input, githubTag: `v${input.version}`, sha256: null, publicationLog: [], installerUrl: null, metadataUrl: null } });
    if (!result.count) throw new ApiError(409, 'RELEASE_NOT_EDITABLE');
    res.json({ success: true, data: await db.updateRelease.findUniqueOrThrow({ where: { id } }) });
  });
  router.post('/:id/disable', async (req, res) => {
    const id = uuid.parse(req.params.id);
    z.object({}).strict().parse(req.body);
    const result = await db.updateRelease.updateMany({ where: { id, status: { in: ['DRAFT', 'PUBLISHED'] } }, data: { status: 'DISABLED' } });
    if (!result.count) throw new ApiError(409, 'INVALID_RELEASE_STATE');
    res.json({ success: true, data: await db.updateRelease.findUniqueOrThrow({ where: { id } }) });
  });
  router.post('/:id/publish', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const initial = await db.updateRelease.findUnique({ where: { id } });
    if (!initial) throw new ApiError(404, 'NOT_FOUND');
    if (initial.status !== 'DRAFT' || initial.githubReleaseId) throw new ApiError(409, 'INVALID_RELEASE_STATE');
    const directory = await mkdtemp(join(tmpdir(), 'central-update-'));
    try {
      const upload = multer({
        preservePath: true,
        storage: multer.diskStorage({ destination: directory, filename: (_req, _file, cb) => cb(null, randomUUID()) }),
        limits: { fileSize: MAX_FILE_BYTES, files: 3, fields: 0, parts: 3, headerPairs: 100 },
        fileFilter: (_req, file, cb) => {
          try {
            if (!['installer', 'metadata', 'blockmap'].includes(file.fieldname)) throw new ApiError(400, 'INVALID_FILE_COUNT');
            validateAssetName(file.originalname, file.fieldname as UpdateAsset['kind'], file.mimetype); cb(null, true);
          } catch (error) { cb(error as Error); }
        },
      }).fields([{ name: 'installer', maxCount: 1 }, { name: 'metadata', maxCount: 1 }, { name: 'blockmap', maxCount: 1 }]);
      await new Promise<void>((resolve, reject) => upload(req, res, error => error ? reject(error instanceof ApiError || error instanceof multer.MulterError ? error : new ApiError(400, 'INVALID_UPLOAD')) : resolve()));
      const files = Object.values((req.files ?? {}) as Record<string, Express.Multer.File[]>).flat();
      const assets: UpdateAsset[] = files.map(f => ({ name: f.originalname, path: f.path, size: f.size, mime: f.mimetype, kind: f.fieldname as UpdateAsset['kind'] }));
      const validated = await validateUpdateAssets(assets, initial.version);
      // Intentionally hard-wired to dry run. Environment/token cannot enable publication.
      const result = await new DryRunPublisher().publish(initial, assets);
      const updated = await db.$transaction(async tx => {
        const product = await tx.product.findUnique({ where: { id: initial.productId } });
        if (!product?.active) throw new ApiError(409, 'INACTIVE_ENTITY');
        const changed = await tx.updateRelease.updateMany({ where: { id, status: 'DRAFT', updatedAt: initial.updatedAt, githubReleaseId: null },
          data: { sha256: validated.sha256, dryRun: true, publicationLog: { steps: result.steps, assets: validated.assets } } });
        if (!changed.count) throw new ApiError(409, 'RELEASE_CHANGED');
        return tx.updateRelease.findUniqueOrThrow({ where: { id } });
      });
      res.json({ success: true, data: updated, dryRun: true, steps: result.steps });
    } catch (error) {
      if (error instanceof multer.MulterError) throw new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_FILE_COUNT');
      throw error;
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  return router;
}
