import { Prisma, PrismaClient } from '@prisma/client';
export const installationSelect = {
  id: true, clientId: true, productId: true, installationId: true, name: true,
  active: true, lastValidationAt: true, createdAt: true, updatedAt: true,
  updateChannel: true, reportedVersion: true, lastUpdateCheckAt: true,
} satisfies Prisma.InstallationSelect;

// All changes to a license and all validations lock its installation first.
// This serializes renewals and prevents duplicate validation audit events.
export async function lockInstallation(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Installation" WHERE id = ${id}::uuid FOR UPDATE`;
}
export function createDatabase(url: string) {
  return new PrismaClient({ datasources: { db: { url } }, log: [] });
}
