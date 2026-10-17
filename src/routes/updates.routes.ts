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
import { validateAssetName, validateUpdateAssets, prepareGitHubAssets, MAX_FILE_BYTES, type UpdateAsset } from '../services/update-files.js';
import { DryRunPublisher, GitHubHttpTransport, GitHubReleasePublisher, PartialPublicationError } from '../services/github-releases.js';
import { checkUpdates } from '../services/updates.js';
import { assertUpdateReactivationSafe } from '../services/update-reactivation.js';
import { reactivationPublicationLog, replacePublicationLog } from '../services/publication-log.js';
import { publicationDiagnostic, RealPublicationApiError } from '../services/publication-diagnostics.js';

export function publicUpdatesRoutes(ctx: Context) {
  const router = Router();
  router.post('/check', async (req, res) => { res.json(await checkUpdates(ctx, checkBody.parse(req.body))); });
  return router;
}
export function updatesRoutes({ db, env }: Context) {
  const router = Router();
  router.get('/configuration', (_req, res) => { res.json({ success: true, realPublicationEnabled: env.GITHUB_UPDATES_ENABLED === 'true' && !!env.GITHUB_UPDATES_TOKEN && !!env.GITHUB_UPDATES_OWNER && !!env.GITHUB_UPDATES_REPO }); });
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
    const result = await db.updateRelease.updateMany({ where: { id, status: 'DRAFT', githubReleaseId: null, updatedAt: existing.updatedAt },
      data: { ...input, githubTag: `v${input.version}`, sha256: null, publicationLog: replacePublicationLog(existing.publicationLog, { mode: 'DRAFT', steps: ['EDIT_DRAFT'] }), installerUrl: null, metadataUrl: null } });
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
  router.post('/:id/reactivate', async (req, res) => {
    const id = uuid.parse(req.params.id);
    z.object({}).strict().parse(req.body);
    const data = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "UpdateRelease" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.updateRelease.findUnique({ where: { id } });
      if (!current) throw new ApiError(404, 'NOT_FOUND');
      if (current.status !== 'DISABLED') throw new ApiError(409, 'INVALID_RELEASE_STATE');
      await assertUpdateReactivationSafe(current, { token: env.GITHUB_UPDATES_TOKEN ?? '', owner: env.GITHUB_UPDATES_OWNER ?? '', repo: env.GITHUB_UPDATES_REPO ?? '' });
      // Snapshot and cleared distribution references are committed atomically on the same row.
      const publicationLog = reactivationPublicationLog(current, res.locals.adminId as string);
      return tx.updateRelease.update({ where: { id }, data: { status: 'DRAFT', dryRun: true, githubReleaseId: null, installerUrl: null, metadataUrl: null, sha256: null, publishedAt: null, publicationLog } });
    }, { timeout: 240000, maxWait: 5000 });
    res.json({ success: true, data });
  });
  router.post(['/:id/publish', '/:id/publish-real'], async (req, res) => {
    const real = req.path.endsWith('/publish-real');
    if (real && (env.GITHUB_UPDATES_ENABLED !== 'true' || !env.GITHUB_UPDATES_TOKEN || !env.GITHUB_UPDATES_OWNER || !env.GITHUB_UPDATES_REPO)) throw new ApiError(503, 'REAL_PUBLICATION_NOT_CONFIGURED');
    const id = uuid.parse(req.params.id);
    const initial = await db.updateRelease.findUnique({ where: { id } });
    if (!initial) throw new ApiError(404, 'NOT_FOUND');
    if (!(real && initial.status === 'PUBLISHED' && !initial.dryRun && initial.githubReleaseId) && (initial.status !== 'DRAFT' || initial.githubReleaseId)) throw new ApiError(409, 'INVALID_RELEASE_STATE');
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
      let validated = await validateUpdateAssets(assets, initial.version, real);
      const prepared = real ? await prepareGitHubAssets(assets) : assets;
      if (real) validated = await validateUpdateAssets(prepared, initial.version, true);
      const transport = real ? new GitHubHttpTransport({ token: env.GITHUB_UPDATES_TOKEN!, owner: env.GITHUB_UPDATES_OWNER!, repo: env.GITHUB_UPDATES_REPO! }) : undefined;
      let publishedId: string | undefined;
      let replayed = false;
      let reconciled = false;
      try {
        const updated = await db.$transaction(async tx => {
          // Serialize publication across processes; editing/disable cannot win during publication.
          await tx.$queryRaw`SELECT id FROM "UpdateRelease" WHERE id = ${id}::uuid FOR UPDATE`;
          const current = await tx.updateRelease.findUniqueOrThrow({ where: { id } });
          if (real && current.status === 'PUBLISHED' && !current.dryRun && current.githubReleaseId) {
            const log = z.object({ assets: z.array(z.object({ name: z.string(), kind: z.string(), size: z.number(), sha256: z.string(), sha512: z.string() })) }).safeParse(current.publicationLog);
            if (!log.success || log.data.assets.length !== 3 || current.sha256 !== validated.sha256 || !validated.assets.every(asset => log.data.assets.some(saved => saved.kind === asset.kind && saved.name === asset.name && saved.size === asset.size && saved.sha256 === asset.sha256 && saved.sha512 === asset.sha512))) throw new ApiError(409, 'PUBLICATION_CONTENT_CONFLICT');
            replayed = true;
            return current;
          }
          if (current.status !== 'DRAFT' || current.githubReleaseId || current.updatedAt.getTime() !== initial.updatedAt.getTime()) throw new ApiError(409, 'RELEASE_CHANGED');
          await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${initial.productId}::uuid FOR SHARE`;
          const product = await tx.product.findUnique({ where: { id: initial.productId } });
          if (!product?.active) throw new ApiError(409, 'INACTIVE_ENTITY');
          const previous = current.publicationLog as { releaseId?: unknown; stage?: unknown } | null;
          const recoveryId = real && ['DOWNLOAD_VERIFY', 'VERIFY_PUBLISHED_RELEASE', 'PERSIST_PUBLICATION', 'CHECK_PUBLIC_REPOSITORY'].includes(String(previous?.stage)) && typeof previous?.releaseId === 'string' && /^[1-9][0-9]*$/.test(previous.releaseId) ? previous.releaseId : undefined;
          const result = await (transport ? new GitHubReleasePublisher(transport).publish(initial, prepared, recoveryId) : new DryRunPublisher().publish(initial, prepared));
          reconciled = result.steps.includes('RECONCILE_EXISTING_RELEASE');
          publishedId = result.githubReleaseId;
          const summaryAssets = validated.assets.map(asset => ({ ...asset, sourceName: assets.find(a => a.kind === asset.kind)!.name, ...(result.assets?.find(a => a.kind === asset.kind) ?? {}) }));
          if (real && (!result.installerUrl || !result.metadataUrl || !publishedId || summaryAssets.some(a => !('id' in a) || !a.id))) throw new ApiError(502, 'UPDATE_METADATA_UNAVAILABLE');
          return tx.updateRelease.update({ where: { id }, data: {
            sha256: validated.sha256, dryRun: !real,
            publicationLog: replacePublicationLog(current.publicationLog, { mode: real ? 'REAL' : 'DRY_RUN', steps: result.steps, assets: summaryAssets }),
            ...(real ? { status: 'PUBLISHED', githubReleaseId: publishedId, installerUrl: result.installerUrl, metadataUrl: result.metadataUrl, publishedAt: new Date() } : {}),
          } });
        }, { timeout: 1_200_000, maxWait: 5000 });
        res.json({ success: true, data: updated, dryRun: !real, replayed, steps: replayed ? ['IDEMPOTENT_REPLAY'] : (updated.publicationLog as { steps: string[] }).steps });
      } catch (error) {
        if (publishedId && transport && !reconciled) { try { await transport.remove(publishedId); } catch { /* Log safe recovery id below. */ } }
        if (real && !(error instanceof ApiError)) {
          const diagnostic = publicationDiagnostic(error);
          const githubId = error instanceof PartialPublicationError ? error.releaseId : publishedId;
          const releaseId = githubId && /^[1-9][0-9]*$/.test(githubId) ? githubId : null;
          console.error('[UPDATES] real publication failed', { releaseId: id, version: initial.version, githubReleaseId: releaseId, ...diagnostic });
          const failure = { releaseId, ...diagnostic, tagPolicy: 'PRESERVE_AND_REUSE' };
          try {
            await db.updateRelease.updateMany({ where: { id, status: 'DRAFT', updatedAt: initial.updatedAt }, data: { publicationLog: replacePublicationLog(initial.publicationLog, { mode: 'REAL', failed: true, ...failure }) } });
          } catch { console.error('[UPDATES] publication diagnostic persistence failed', { releaseId: id, code: 'PUBLICATION_DIAGNOSTIC_PERSIST_FAILED' }); }
          throw new RealPublicationApiError(diagnostic);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof multer.MulterError) throw new ApiError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'INVALID_FILE_COUNT');
      throw error;
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  return router;
}
