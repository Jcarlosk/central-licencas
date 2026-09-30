import type { Prisma, EventType } from '@prisma/client';
import type { Context } from '../types/context.js';
import { lockInstallation } from '../repositories/database.js';
import { ApiError } from '../utils/errors.js';
import { DAY_MS, licenseStatus, renewalDates } from './license-policy.js';
import { matchesSecret } from '../utils/secrets.js';
import { signLicense, type SignedLicense } from '../utils/signature.js';

async function event(tx: Prisma.TransactionClient, installationId: string, licenseId: string, type: EventType, description: string, metadata: Prisma.InputJsonObject) {
  await tx.licenseEvent.create({ data: { installationId, licenseId, type, description, metadata } });
}
export async function createLicense({ db }: Context, input: { installationId: string; days: number; graceDays: number; notes?: string | null }, adminId: string) {
  return db.$transaction(async tx => {
    await lockInstallation(tx, input.installationId);
    const installation = await tx.installation.findUnique({ where: { id: input.installationId }, include: { client: true, product: true } });
    if (!installation) throw new ApiError(404, 'NOT_FOUND');
    if (!installation.active || !installation.client.active || !installation.product.active) throw new ApiError(409, 'INACTIVE_ENTITY');
    const now = new Date();
    const license = await tx.license.create({ data: { installationId: input.installationId, notes: input.notes, startsAt: now, expiresAt: new Date(now.getTime() + input.days * DAY_MS), graceUntil: new Date(now.getTime() + (input.days + input.graceDays) * DAY_MS) } });
    await event(tx, license.installationId, license.id, 'LICENSE_CREATED', 'Licença criada', { adminId, days: input.days, graceDays: input.graceDays });
    return license;
  });
}
export async function changeLicense({ db }: Context, id: string, action: 'renew' | 'suspend' | 'reactivate' | 'revoke', input: { days?: number; graceDays?: number; reason?: string }, adminId: string) {
  return db.$transaction(async tx => {
    const initial = await tx.license.findUnique({ where: { id }, select: { installationId: true } });
    if (!initial) throw new ApiError(404, 'NOT_FOUND');
    await lockInstallation(tx, initial.installationId);
    const current = await tx.license.findUniqueOrThrow({ where: { id } });
    if (current.status === 'REVOKED') throw new ApiError(409, 'LICENSE_REVOKED');
    const now = new Date();
    let data: Prisma.LicenseUpdateInput;
    let type: EventType;
    switch (action) {
      case 'renew':
        data = renewalDates(current.expiresAt, now, input.days!, input.graceDays!);
        type = 'LICENSE_RENEWED'; break;
      case 'suspend':
        if (current.status === 'SUSPENDED') throw new ApiError(409, 'ALREADY_SUSPENDED');
        data = { status: 'SUSPENDED', suspendedAt: now }; type = 'LICENSE_SUSPENDED'; break;
      case 'reactivate':
        if (current.status !== 'SUSPENDED') throw new ApiError(409, 'LICENSE_NOT_SUSPENDED');
        data = { status: 'ACTIVE', suspendedAt: null }; type = 'LICENSE_REACTIVATED'; break;
      case 'revoke':
        data = { status: 'REVOKED', revokedAt: now }; type = 'LICENSE_REVOKED'; break;
    }
    const license = await tx.license.update({ where: { id }, data });
    await event(tx, license.installationId, id, type, input.reason ?? action, {
      adminId, previousStatus: current.status, status: license.status,
      previousExpiresAt: current.expiresAt.toISOString(), expiresAt: license.expiresAt.toISOString(),
      previousGraceUntil: current.graceUntil.toISOString(), graceUntil: license.graceUntil.toISOString(),
      ...(action === 'renew' ? { days: input.days!, graceDays: input.graceDays! } : {}),
    });
    return license;
  });
}
export async function validateLicense({ db, privateKey }: Context, input: { installationId: string; installationSecret: string }) {
  // Constant-time comparison for fixed-size SHA-256 digests, including unknown IDs.
  const initial = await db.installation.findUnique({ where: { installationId: input.installationId }, select: { id: true, secretHash: true } });
  if (!matchesSecret(input.installationSecret, initial?.secretHash) || !initial) throw new ApiError(401, 'INVALID_INSTALLATION_CREDENTIALS');
  return db.$transaction(async tx => {
    await lockInstallation(tx, initial.id);
    // Refresh all state AFTER taking the lock. Client/product row share locks make
    // their active flags consistent with concurrent administrative updates.
    const installation = await tx.installation.findUniqueOrThrow({ where: { id: initial.id }, include: { client: true, product: true, license: true } });
    await tx.$queryRaw`SELECT id FROM "Client" WHERE id = ${installation.clientId}::uuid FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${installation.productId}::uuid FOR SHARE`;
    const client = await tx.client.findUniqueOrThrow({ where: { id: installation.clientId }, select: { active: true } });
    const product = await tx.product.findUniqueOrThrow({ where: { id: installation.productId }, select: { active: true, code: true } });
    if (!installation.license) throw new ApiError(404, 'LICENSE_NOT_FOUND');
    const now = new Date();
    const enabled = installation.active && client.active && product.active;
    const status = licenseStatus(installation.license, now, enabled);
    const audit = installation.lastValidationStatus !== status || !installation.lastValidationEventAt || now.getTime() - installation.lastValidationEventAt.getTime() >= DAY_MS;
    await tx.installation.update({ where: { id: installation.id }, data: { lastValidationAt: now, lastValidationStatus: status, ...(audit ? { lastValidationEventAt: now } : {}) } });
    if (audit) await event(tx, installation.id, installation.license.id, 'LICENSE_VALIDATED', 'Validação de licença', { status, previousStatus: installation.lastValidationStatus, enabled });
    const license: SignedLicense = {
      installationId: installation.installationId, product: product.code, status,
      issuedAt: now.toISOString(), expiresAt: installation.license.expiresAt.toISOString(), graceUntil: installation.license.graceUntil.toISOString(),
    };
    // Sign inside the transaction: signing failure rolls back validation records.
    return { success: true, license, signature: signLicense(license, privateKey) };
  }, { timeout: 10000 });
}
