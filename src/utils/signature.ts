import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Env } from '../config/env.js';

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
function parseSigningKeys(privatePem: Buffer, publicPem: Buffer) {
  const privateKey = createPrivateKey({ key: privatePem, format: 'pem' });
  const publicKey = createPublicKey({ key: publicPem, format: 'pem' });
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') throw new Error();
  const probe = Buffer.from('central-licencas-key-check');
  if (!verify(null, probe, publicKey, sign(null, probe, privateKey))) throw new Error();
  return { privateKey, publicKey };
}

export function loadSigningKeys(privatePath: string | undefined, publicPath: string | undefined) {
  try {
    if (!privatePath || !publicPath) throw new Error();
    return parseSigningKeys(readFileSync(privatePath), readFileSync(publicPath));
  } catch { throw new Error('Signing keys unavailable, invalid, or mismatched'); }
}

function decodeBase64Pem(value: string): Buffer {
  // Node's decoder is permissive. Require standard, canonical Base64 instead
  // of accepting ignored characters, missing padding or an empty payload.
  if (value.length > 16384 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error();
  const pem = Buffer.from(value, 'base64');
  if (pem.length === 0 || pem.toString('base64') !== value) throw new Error();
  return pem;
}

type SigningKeyEnv = Pick<Env, 'LICENSE_PRIVATE_KEY_PATH' | 'LICENSE_PUBLIC_KEY_PATH' | 'LICENSE_PRIVATE_KEY_BASE64' | 'LICENSE_PUBLIC_KEY_BASE64'>;
export function loadSigningKeysFromEnv(env: SigningKeyEnv) {
  const privateBase64 = env.LICENSE_PRIVATE_KEY_BASE64 || undefined;
  const publicBase64 = env.LICENSE_PUBLIC_KEY_BASE64 || undefined;
  if (privateBase64 === undefined && publicBase64 === undefined) {
    return loadSigningKeys(env.LICENSE_PRIVATE_KEY_PATH, env.LICENSE_PUBLIC_KEY_PATH);
  }
  try {
    // A partial/invalid Base64 pair must fail, never silently fall back to files.
    if (!privateBase64 || !publicBase64) throw new Error();
    return parseSigningKeys(decodeBase64Pem(privateBase64), decodeBase64Pem(publicBase64));
  } catch { throw new Error('Signing keys unavailable, invalid, or mismatched'); }
}
