import { describe, it, expect } from 'vitest';
import { DAY_MS, licenseStatus, renewalDates } from '../src/services/license-policy.js';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalizeLicense, signLicense, verifyLicense, type SignedLicense } from '../src/utils/signature.js';
const now = new Date('2026-09-30T20:00:00.000Z');
const base = { status: 'ACTIVE' as const, startsAt: new Date(now.getTime() - DAY_MS), expiresAt: now, graceUntil: new Date(now.getTime() + 5 * DAY_MS) };
describe('Server-side license rules', () => {
  it('includes exact expiry in ACTIVE', () => expect(licenseStatus(base, now)).toBe('ACTIVE'));
  it('starts GRACE one millisecond after expiry', () => expect(licenseStatus(base, new Date(now.getTime() + 1))).toBe('GRACE'));
  it('includes exact grace boundary', () => expect(licenseStatus(base, base.graceUntil)).toBe('GRACE'));
  it('expires one millisecond after grace', () => expect(licenseStatus(base, new Date(base.graceUntil.getTime() + 1))).toBe('EXPIRED'));
  it('suspension overrides expired dates', () => expect(licenseStatus({ ...base, status: 'SUSPENDED' }, new Date('2030-01-01Z'))).toBe('SUSPENDED'));
  it('revocation overrides disabled entities', () => expect(licenseStatus({ ...base, status: 'REVOKED' }, now, false)).toBe('REVOKED'));
  it('future start never authorizes usage', () => expect(licenseStatus({ ...base, startsAt: new Date(now.getTime() + 1) }, now)).toBe('EXPIRED'));
  it('renews valid license from existing expiry', () => {
    const expiry = new Date(now.getTime() + 10 * DAY_MS);
    expect(renewalDates(expiry, now, 30, 5)).toEqual({ expiresAt: new Date(now.getTime() + 40 * DAY_MS), graceUntil: new Date(now.getTime() + 45 * DAY_MS) });
  });
  it('renews expired license from now, including during grace', () => expect(renewalDates(new Date(now.getTime() - DAY_MS), now, 30, 0)).toEqual({ expiresAt: new Date(now.getTime() + 30 * DAY_MS), graceUntil: new Date(now.getTime() + 30 * DAY_MS) }));
});
describe('Ed25519 protocol', () => {
  const keys = generateKeyPairSync('ed25519');
  const payload: SignedLicense = { installationId: 'BANABUIU-001', product: 'sistema-atendimento', status: 'ACTIVE', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * DAY_MS).toISOString(), graceUntil: new Date(now.getTime() + 35 * DAY_MS).toISOString() };
  it('verifies valid signature', () => expect(verifyLicense(payload, signLicense(payload, keys.privateKey), keys.publicKey)).toBe(true));
  it('canonicalization ignores property insertion order and has exact wire format', () => {
    const reordered = Object.fromEntries(Object.entries(payload).reverse()) as SignedLicense;
    expect(canonicalizeLicense(reordered)).toBe(canonicalizeLicense(payload));
    expect(canonicalizeLicense(payload)).toBe('{"expiresAt":"2026-10-30T20:00:00.000Z","graceUntil":"2026-11-04T20:00:00.000Z","installationId":"BANABUIU-001","issuedAt":"2026-09-30T20:00:00.000Z","product":"sistema-atendimento","status":"ACTIVE"}');
  });
  it.each([
    ['installationId', 'OTHER-001'], ['product', 'other-product'], ['status', 'REVOKED'],
    ['issuedAt', '2026-10-01T00:00:00.000Z'], ['expiresAt', '2030-01-01T00:00:00.000Z'], ['graceUntil', '2030-01-02T00:00:00.000Z'],
  ])('rejects tampering of %s', (field, value) => expect(verifyLicense({ ...payload, [field]: value } as SignedLicense, signLicense(payload, keys.privateKey), keys.publicKey)).toBe(false));
  it('rejects other public key', () => expect(verifyLicense(payload, signLicense(payload, keys.privateKey), generateKeyPairSync('ed25519').publicKey)).toBe(false));
  it('rejects extra fields and malformed signatures', () => {
    expect(verifyLicense({ ...payload, unexpected: true } as SignedLicense, signLicense(payload, keys.privateKey), keys.publicKey)).toBe(false);
    expect(verifyLicense(payload, 'invalid', keys.publicKey)).toBe(false);
  });
});
