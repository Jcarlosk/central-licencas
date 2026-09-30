import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { loadEnv } from '../src/config/env.js';
import { loadSigningKeysFromEnv, signLicense, verifyLicense, type SignedLicense } from '../src/utils/signature.js';

const pair = () => generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const toBase64 = (pem: string) => Buffer.from(pem, 'utf8').toString('base64');
const keys = pair();
const encoded = {
  LICENSE_PRIVATE_KEY_BASE64: toBase64(keys.privateKey),
  LICENSE_PUBLIC_KEY_BASE64: toBase64(keys.publicKey),
};
const payload: SignedLicense = {
  installationId: 'BANABUIU-001', product: 'sistema-atendimento', status: 'ACTIVE',
  issuedAt: '2026-09-30T20:00:00.000Z', expiresAt: '2026-10-30T20:00:00.000Z', graceUntil: '2026-11-04T20:00:00.000Z',
};
const errorMessage = 'Signing keys unavailable, invalid, or mismatched';
const fields = ['LICENSE_PRIVATE_KEY_PATH', 'LICENSE_PUBLIC_KEY_PATH', 'LICENSE_PRIVATE_KEY_BASE64', 'LICENSE_PUBLIC_KEY_BASE64'] as const;
afterEach(() => { vi.unstubAllEnvs(); });
function setKeyEnv(values: Partial<Record<typeof fields[number], string>>) {
  for (const field of fields) vi.stubEnv(field, values[field] ?? '');
}
function unsetKeyEnv() {
  for (const field of fields) vi.stubEnv(field, undefined);
}

describe('Base64 signing key loading', () => {
  it('loads real Ed25519 keys entirely in memory without paths and signs/verifies', () => {
    const loaded = loadSigningKeysFromEnv(encoded);
    expect(loaded.privateKey.asymmetricKeyType).toBe('ed25519');
    expect(loaded.publicKey.asymmetricKeyType).toBe('ed25519');
    const signature = signLicense(payload, loaded.privateKey);
    expect(verifyLicense(payload, signature, loaded.publicKey)).toBe(true);
    expect(verifyLicense({ ...payload, product: 'adulterado' }, signature, loaded.publicKey)).toBe(false);
  });
  it('prioritizes Base64 without reading non-existent PEM paths', () => {
    const loaded = loadSigningKeysFromEnv({ ...encoded, LICENSE_PRIVATE_KEY_PATH: 'non-existent-private.pem', LICENSE_PUBLIC_KEY_PATH: 'non-existent-public.pem' });
    expect(verifyLicense(payload, signLicense(payload, loaded.privateKey), loaded.publicKey)).toBe(true);
  });
  it('uses the existing PEM files when Base64 is absent or empty', () => {
    for (const base64 of [{}, { LICENSE_PRIVATE_KEY_BASE64: '', LICENSE_PUBLIC_KEY_BASE64: '' }]) {
      const loaded = loadSigningKeysFromEnv({ ...base64, LICENSE_PRIVATE_KEY_PATH: process.env.LICENSE_PRIVATE_KEY_PATH, LICENSE_PUBLIC_KEY_PATH: process.env.LICENSE_PUBLIC_KEY_PATH });
      expect(verifyLicense(payload, signLicense(payload, loaded.privateKey), loaded.publicKey)).toBe(true);
    }
  });
  it.each(['private', 'public'])('rejects a partial Base64 pair (%s only), without falling back to valid files', which => {
    const partial = which === 'private' ? { LICENSE_PRIVATE_KEY_BASE64: encoded.LICENSE_PRIVATE_KEY_BASE64 } : { LICENSE_PUBLIC_KEY_BASE64: encoded.LICENSE_PUBLIC_KEY_BASE64 };
    expect(() => loadSigningKeysFromEnv({ ...partial, LICENSE_PRIVATE_KEY_PATH: process.env.LICENSE_PRIVATE_KEY_PATH, LICENSE_PUBLIC_KEY_PATH: process.env.LICENSE_PUBLIC_KEY_PATH })).toThrow(errorMessage);
  });
  it.each(['private', 'public'])('rejects invalid Base64 in the %s key', which => {
    const invalid = which === 'private' ? { ...encoded, LICENSE_PRIVATE_KEY_BASE64: '!!!invalid-base64!!!' } : { ...encoded, LICENSE_PUBLIC_KEY_BASE64: '!!!invalid-base64!!!' };
    expect(() => loadSigningKeysFromEnv(invalid)).toThrow(errorMessage);
  });
  it('rejects non-canonical Base64, whitespace and oversized inputs', () => {
    for (const invalid of ['Zh==', `${encoded.LICENSE_PRIVATE_KEY_BASE64}\n`, 'A'.repeat(16388)]) {
      expect(() => loadSigningKeysFromEnv({ ...encoded, LICENSE_PRIVATE_KEY_BASE64: invalid })).toThrow(errorMessage);
    }
  });
  it('rejects decoded content that is not a PEM key', () => {
    expect(() => loadSigningKeysFromEnv({ ...encoded, LICENSE_PRIVATE_KEY_BASE64: toBase64('not a PEM key') })).toThrow(errorMessage);
  });
  it('rejects mismatched real Ed25519 pairs', () => {
    expect(() => loadSigningKeysFromEnv({ ...encoded, LICENSE_PUBLIC_KEY_BASE64: toBase64(pair().publicKey) })).toThrow(errorMessage);
  });
  it('rejects a valid matching key pair using another algorithm', () => {
    const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    expect(() => loadSigningKeysFromEnv({ LICENSE_PRIVATE_KEY_BASE64: toBase64(ec.privateKey), LICENSE_PUBLIC_KEY_BASE64: toBase64(ec.publicKey) })).toThrow(errorMessage);
  });
  it('invalid Base64 has no fallback even when PEM paths are valid', () => {
    expect(() => loadSigningKeysFromEnv({ ...encoded, LICENSE_PRIVATE_KEY_BASE64: toBase64('invalid PEM'), LICENSE_PRIVATE_KEY_PATH: process.env.LICENSE_PRIVATE_KEY_PATH, LICENSE_PUBLIC_KEY_PATH: process.env.LICENSE_PUBLIC_KEY_PATH })).toThrow(errorMessage);
  });
  it('errors contain only a generic message, without key data or paths', () => {
    let message = '';
    try { loadSigningKeysFromEnv({ ...encoded, LICENSE_PUBLIC_KEY_BASE64: toBase64(pair().publicKey) }); }
    catch (error) { message = error instanceof Error ? error.message : ''; }
    expect(message).toBe(errorMessage);
  });
});

describe('Signing key environment validation', () => {
  it('accepts a complete Base64 pair with PATH variables truly absent', () => {
    unsetKeyEnv();
    vi.stubEnv('LICENSE_PRIVATE_KEY_BASE64', encoded.LICENSE_PRIVATE_KEY_BASE64);
    vi.stubEnv('LICENSE_PUBLIC_KEY_BASE64', encoded.LICENSE_PUBLIC_KEY_BASE64);
    const env = loadEnv();
    expect(env.LICENSE_PRIVATE_KEY_PATH === undefined && env.LICENSE_PUBLIC_KEY_PATH === undefined).toBe(true);
    const loaded = loadSigningKeysFromEnv(env);
    expect(verifyLicense(payload, signLicense(payload, loaded.privateKey), loaded.publicKey)).toBe(true);
  });
  it('accepts a complete PATH pair with Base64 variables truly absent', () => {
    const privatePath = process.env.LICENSE_PRIVATE_KEY_PATH;
    const publicPath = process.env.LICENSE_PUBLIC_KEY_PATH;
    unsetKeyEnv();
    vi.stubEnv('LICENSE_PRIVATE_KEY_PATH', privatePath);
    vi.stubEnv('LICENSE_PUBLIC_KEY_PATH', publicPath);
    const loaded = loadSigningKeysFromEnv(loadEnv());
    expect(verifyLicense(payload, signLicense(payload, loaded.privateKey), loaded.publicKey)).toBe(true);
  });
  it.each([
    ['LICENSE_PRIVATE_KEY_BASE64', 'LICENSE_PUBLIC_KEY_BASE64', encoded.LICENSE_PRIVATE_KEY_BASE64],
    ['LICENSE_PUBLIC_KEY_BASE64', 'LICENSE_PRIVATE_KEY_BASE64', encoded.LICENSE_PUBLIC_KEY_BASE64],
    ['LICENSE_PRIVATE_KEY_PATH', 'LICENSE_PUBLIC_KEY_PATH', 'keys/license-private.pem'],
    ['LICENSE_PUBLIC_KEY_PATH', 'LICENSE_PRIVATE_KEY_PATH', 'keys/license-public.pem'],
  ] as const)('rejects %s alone with a safe incomplete-pair error', (provided, missing, value) => {
    unsetKeyEnv();
    vi.stubEnv(provided, value);
    expect(() => loadEnv()).toThrow(`Invalid environment fields: ${missing}`);
  });
  it('discards invalid PATHs before environment validation when Base64 is complete', () => {
    setKeyEnv({ ...encoded, LICENSE_PRIVATE_KEY_PATH: 'nonexistent-invalid-private.pem', LICENSE_PUBLIC_KEY_PATH: 'nonexistent-invalid-public.pem' });
    const env = loadEnv();
    expect(env.LICENSE_PRIVATE_KEY_PATH === undefined && env.LICENSE_PUBLIC_KEY_PATH === undefined).toBe(true);
    const loaded = loadSigningKeysFromEnv(env);
    expect(verifyLicense(payload, signLicense(payload, loaded.privateKey), loaded.publicKey)).toBe(true);
  });
  it('Base64 takes priority even if only one PATH is present', () => {
    setKeyEnv({ ...encoded, LICENSE_PRIVATE_KEY_PATH: 'nonexistent-private.pem' });
    const env = loadEnv();
    expect(env.LICENSE_PRIVATE_KEY_PATH === undefined && env.LICENSE_PUBLIC_KEY_PATH === undefined).toBe(true);
    const loaded = loadSigningKeysFromEnv(env);
    expect(verifyLicense(payload, signLicense(payload, loaded.privateKey), loaded.publicKey)).toBe(true);
  });
  it('allows production with Base64 only and no paths', () => {
    vi.stubEnv('NODE_ENV', 'production');
    setKeyEnv(encoded);
    const env = loadEnv();
    expect(env.LICENSE_PRIVATE_KEY_PATH === undefined).toBe(true);
    expect(env.LICENSE_PUBLIC_KEY_PATH === undefined).toBe(true);
    const loaded = loadSigningKeysFromEnv(env);
    expect(verifyLicense(payload, signLicense(payload, loaded.privateKey), loaded.publicKey)).toBe(true);
  });
  it('preserves local path-only configuration', () => {
    setKeyEnv({ LICENSE_PRIVATE_KEY_PATH: 'keys/license-private.pem', LICENSE_PUBLIC_KEY_PATH: 'keys/license-public.pem' });
    const env = loadEnv();
    expect(env.LICENSE_PRIVATE_KEY_PATH).toBe('keys/license-private.pem');
    expect(env.LICENSE_PUBLIC_KEY_PATH).toBe('keys/license-public.pem');
  });
  it.each(['LICENSE_PRIVATE_KEY_BASE64', 'LICENSE_PUBLIC_KEY_BASE64'] as const)('rejects missing %s even with configured paths', missing => {
    setKeyEnv({ ...encoded, [missing]: '', LICENSE_PRIVATE_KEY_PATH: 'keys/license-private.pem', LICENSE_PUBLIC_KEY_PATH: 'keys/license-public.pem' });
    expect(() => loadEnv()).toThrow(`Invalid environment fields: ${missing}`);
  });
  it('requires both paths when both Base64 settings are absent', () => {
    setKeyEnv({});
    expect(() => loadEnv()).toThrow('Invalid environment fields: LICENSE_PRIVATE_KEY_PATH, LICENSE_PUBLIC_KEY_PATH');
  });
});
