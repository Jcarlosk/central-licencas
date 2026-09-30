import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const signedLicenseSchema = z.object({
  installationId: z.string(), product: z.string(),
  status: z.enum(['ACTIVE', 'GRACE', 'SUSPENDED', 'REVOKED', 'EXPIRED']),
  issuedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), graceUntil: z.iso.datetime(),
}).strict();
export type SignedLicense = z.infer<typeof signedLicenseSchema>;

// Protocol v1: flat object, keys sorted in ASCII order, compact JSON, UTF-8.
// Validate exact keys/types before canonicalization; no implicit field omission.
export function canonicalizeLicense(payload: SignedLicense): string {
  const data = signedLicenseSchema.parse(payload);
  return JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}
export function signLicense(payload: SignedLicense, privateKey: KeyObject): string {
  return sign(null, Buffer.from(canonicalizeLicense(payload), 'utf8'), privateKey).toString('base64url');
}
export function verifyLicense(payload: SignedLicense, signature: string, publicKey: KeyObject): boolean {
  try {
    if (!/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
    return verify(null, Buffer.from(canonicalizeLicense(payload), 'utf8'), publicKey, Buffer.from(signature, 'base64url'));
  } catch { return false; }
}
export function loadSigningKeys(privatePath: string, publicPath: string) {
  try {
    const privateKey = createPrivateKey(readFileSync(privatePath));
    const publicKey = createPublicKey(readFileSync(publicPath));
    if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') throw new Error();
    const probe = Buffer.from('central-licencas-key-check');
    if (!verify(null, probe, publicKey, sign(null, probe, privateKey))) throw new Error();
    return { privateKey, publicKey };
  } catch { throw new Error('Signing keys unavailable, invalid, or mismatched'); }
}
