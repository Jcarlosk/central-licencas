import { it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import bcrypt from 'bcryptjs';
import { createDatabase } from '../src/repositories/database.js';
import { loadEnv } from '../src/config/env.js';
import { loadSigningKeys, signLicense, verifyLicense, type SignedLicense } from '../src/utils/signature.js';

if (process.env.CENTRAL_ISOLATED_TEST !== 'true' || process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL?.endsWith('/central_test')) throw new Error('Run npm test: isolated database required');
const db = createDatabase(loadEnv().DATABASE_URL);
const tempRoot = realpathSync(tmpdir());
const directories: string[] = [];
afterAll(async () => {
  await db.$disconnect();
  for (const directory of directories) {
    const target = resolve(directory);
    if (dirname(target) !== tempRoot || !basename(target).startsWith('central-keys-test-')) throw new Error('Unsafe temporary cleanup path');
    rmSync(target, { recursive: true, force: true });
  }
});
function runScript(name: string, options: { cwd?: string; stdin?: string; args?: string[] } = {}) {
  return new Promise<{ code: number | null; output: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve(`scripts/${name}.ts`), ...(options.args ?? [])], { cwd: options.cwd, env: process.env, windowsHide: true, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', code => resolveResult({ code, output }));
    child.stdin.end(options.stdin ?? '');
  });
}
it('create-admin script hashes secure stdin input, never prints credentials, and rejects duplicates', async () => {
  const password = randomBytes(24).toString('base64url');
  const email = `${randomUUID()}@example.test`;
  const input = JSON.stringify({ name: 'Admin CLI', email, password });
  const result = await runScript('create-admin', { stdin: input });
  expect(result.code).toBe(0);
  const admin = await db.admin.findUniqueOrThrow({ where: { email } });
  expect(await bcrypt.compare(password, admin.passwordHash)).toBe(true);
  expect(result.output).not.toContain(password);
  expect(result.output).not.toContain(admin.passwordHash);
  expect((await runScript('create-admin', { stdin: input })).code).toBe(1);
});
it('create-admin rejects weak passwords without creating account or logging input', async () => {
  const email = `${randomUUID()}@example.test`;
  const password = randomBytes(3).toString('hex');
  const result = await runScript('create-admin', { stdin: JSON.stringify({ name: 'Invalid', email, password }) });
  expect(result.code).toBe(1);
  expect(result.output).not.toContain(password);
  expect(await db.admin.findUnique({ where: { email } })).toBeNull();
});
it('generate-keys creates usable Ed25519 pair and refuses to overwrite; public-only verification CLI works', async () => {
  const directory = mkdtempSync(join(tempRoot, 'central-keys-test-'));
  directories.push(directory);
  expect((await runScript('generate-signing-keys', { cwd: directory })).code).toBe(0);
  const privatePath = join(directory, 'keys/license-private.pem');
  const publicPath = join(directory, 'keys/license-public.pem');
  const original = readFileSync(privatePath, 'utf8');
  const keys = loadSigningKeys(privatePath, publicPath);
  const payload: SignedLicense = { installationId: 'BANABUIU-001', product: 'sistema-atendimento', status: 'ACTIVE', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), graceUntil: new Date(Date.now() + 2 * 86400000).toISOString() };
  const signature = signLicense(payload, keys.privateKey);
  expect(verifyLicense(payload, signature, keys.publicKey)).toBe(true);
  expect((await runScript('generate-signing-keys', { cwd: directory })).code).toBe(1);
  expect(readFileSync(privatePath, 'utf8')).toBe(original);
  const responsePath = join(directory, 'response.json');
  writeFileSync(responsePath, JSON.stringify({ success: true, license: payload, signature }));
  expect((await runScript('verify-license', { args: [responsePath, publicPath] })).code).toBe(0);
  writeFileSync(responsePath, JSON.stringify({ success: true, license: { ...payload, status: 'REVOKED' }, signature }));
  expect((await runScript('verify-license', { args: [responsePath, publicPath] })).code).toBe(1);
});
