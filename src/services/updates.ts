import semver from 'semver';
import { z } from 'zod';
import type { UpdateRelease } from '@prisma/client';
import type { Context } from '../types/context.js';
import type { UpdateCheckInput, UpdateCheckResponse } from '../utils/update-schemas.js';
import { ApiError } from '../utils/errors.js';
import { validateLicense } from './licenses.js';
import { lockInstallation } from '../repositories/database.js';
import { licenseStatus } from './license-policy.js';

// Global rollout for the product. Future installation targeting belongs here.
export function selectUpdate(releases: UpdateRelease[], currentVersion: string, channel: 'stable' | 'beta') {
  return releases.filter(r => r.status === 'PUBLISHED' && !r.dryRun && r.channel === channel &&
    r.installerUrl?.startsWith('https://') && r.sha256 && /^[a-f0-9]{64}$/.test(r.sha256) &&
    semver.valid(r.version) && (channel !== 'stable' || !semver.prerelease(r.version)) && semver.gt(r.version, currentVersion))
    .sort((a, b) => semver.rcompare(a.version, b.version))[0];
}
// Existing JSON summary can hold installer metadata without a schema migration.
// Legacy summaries do not persist SHA-512 and must not produce an incomplete update.
export function updateResponse(release: UpdateRelease): UpdateCheckResponse {
  const summary = z.object({ assets: z.array(z.object({
    kind: z.string(), name: z.string(), size: z.number(), sha512: z.string().optional(),
  })) }).safeParse(release.publicationLog);
  const installer = summary.success ? summary.data.assets.find(asset => asset.kind === 'installer') : undefined;
  if (!installer || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,159}\.exe$/i.test(installer.name) || installer.name.includes('..') ||
    !Number.isSafeInteger(installer.size) || installer.size <= 0 ||
    !installer.sha512 || !/^[A-Za-z0-9+/]{86}==$/.test(installer.sha512)) {
    throw new ApiError(503, 'UPDATE_METADATA_UNAVAILABLE');
  }
  return { updateAvailable: true, version: release.version, channel: release.channel, mandatory: release.mandatory,
    title: release.title, notes: release.notes, downloadUrl: release.installerUrl!, sha256: release.sha256!,
    sha512: installer.sha512, size: installer.size, fileName: installer.name };
}
export async function checkUpdates(ctx: Context, input: UpdateCheckInput): Promise<UpdateCheckResponse> {
  // Reuses credentials, policy, signature and licensing audit, without a new secret.
  const validation = await validateLicense(ctx, input);
  if (validation.license.product !== input.product) throw new ApiError(403, 'PRODUCT_MISMATCH');
  if (!['ACTIVE', 'GRACE'].includes(validation.license.status)) throw new ApiError(403, `LICENSE_${validation.license.status}`);
  return ctx.db.$transaction(async tx => {
    const initial = await tx.installation.findUniqueOrThrow({ where: { installationId: input.installationId }, select: { id: true } });
    await lockInstallation(tx, initial.id);
    const installation = await tx.installation.findUniqueOrThrow({ where: { id: initial.id }, include: { license: true } });
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${installation.clientId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${installation.productId}::uuid FOR SHARE`;
    const client = await tx.client.findUniqueOrThrow({ where: { id: installation.clientId } });
    const product = await tx.product.findUniqueOrThrow({ where: { id: installation.productId } });
    if (product.code !== input.product) throw new ApiError(403, 'PRODUCT_MISMATCH');
    if (!installation.license) throw new ApiError(404, 'LICENSE_NOT_FOUND');
    const status = licenseStatus(installation.license, new Date(), installation.active && client.active && product.active);
    if (!['ACTIVE', 'GRACE'].includes(status)) throw new ApiError(403, `LICENSE_${status}`);
    if (input.channel === 'beta' && installation.updateChannel !== 'beta') throw new ApiError(403, 'UPDATE_CHANNEL_NOT_ALLOWED');
    await tx.installation.update({ where: { id: installation.id }, data: { reportedVersion: input.currentVersion, lastUpdateCheckAt: new Date() } });
    const release = selectUpdate(await tx.updateRelease.findMany({ where: { productId: installation.productId, channel: input.channel, status: 'PUBLISHED', dryRun: false } }), input.currentVersion, input.channel);
    return release ? updateResponse(release) : { updateAvailable: false };
  });
}
