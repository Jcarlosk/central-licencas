import type { License, ValidationStatus } from '@prisma/client';
export const DAY_MS = 86_400_000;
export function licenseStatus(license: Pick<License, 'status' | 'startsAt' | 'expiresAt' | 'graceUntil'>, now: Date, enabled = true): ValidationStatus {
  if (license.status === 'REVOKED') return 'REVOKED';
  if (license.status === 'SUSPENDED' || !enabled) return 'SUSPENDED';
  if (now < license.startsAt) return 'EXPIRED';
  if (now <= license.expiresAt) return 'ACTIVE';
  if (now <= license.graceUntil) return 'GRACE';
  return 'EXPIRED';
}
export function renewalDates(expiresAt: Date, now: Date, days: number, graceDays: number) {
  const nextExpiry = new Date(Math.max(expiresAt.getTime(), now.getTime()) + days * DAY_MS);
  return { expiresAt: nextExpiry, graceUntil: new Date(nextExpiry.getTime() + graceDays * DAY_MS) };
}
