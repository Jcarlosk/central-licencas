import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { logStartupConfiguration, logEnvValidationFailure, logSigningKeyFailure } from '../src/config/startup.js';
import { EnvValidationError } from '../src/config/env.js';
import { loadSigningKeys, SigningKeyConfigurationError } from '../src/utils/signature.js';

const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const base64 = (pem: string) => Buffer.from(pem).toString('base64');
const validKeys = { LICENSE_PRIVATE_KEY_BASE64: base64(keys.privateKey), LICENSE_PUBLIC_KEY_BASE64: base64(keys.publicKey) };

describe('Safe startup diagnostics', () => {
  it('logs only configuration presence and an allowlisted NODE_ENV', () => {
    const secret = randomBytes(32).toString('hex');
    const logs: string[] = [];
    logStartupConfiguration({ NODE_ENV: 'production', DATABASE_URL: secret, JWT_SECRET: secret, LICENSE_PRIVATE_KEY_BASE64: secret, LICENSE_PUBLIC_KEY_BASE64: secret, LICENSE_PRIVATE_KEY_PATH: secret }, message => logs.push(message));
    expect(logs).toEqual([
      '[STARTUP] NODE_ENV: production', '[STARTUP] DATABASE_URL: configured', '[STARTUP] DATABASE_URL scheme: invalid', '[STARTUP] JWT_SECRET: configured',
      '[STARTUP] LICENSE_PRIVATE_KEY_BASE64: configured', '[STARTUP] LICENSE_PUBLIC_KEY_BASE64: configured',
      '[STARTUP] LICENSE_PRIVATE_KEY_PATH: configured', '[STARTUP] LICENSE_PUBLIC_KEY_PATH: missing',
    ]);
    const hostile: string[] = [];
    logStartupConfiguration({ NODE_ENV: `${secret}\n[INJECTED]` }, message => hostile.push(message));
    expect(hostile[0]).toBe('[STARTUP] NODE_ENV: invalid');
    expect(hostile.some(line => line.includes(secret))).toBe(false);
  });
  it('logs default development without exposing any environment values', () => {
    const logs: string[] = [];
    logStartupConfiguration({}, message => logs.push(message));
    expect(logs[0]).toBe('[STARTUP] NODE_ENV: development');
    expect(logs.includes('[STARTUP] DATABASE_URL scheme: invalid')).toBe(true);
    expect(logs.slice(1).filter(line => !line.startsWith('[STARTUP] DATABASE_URL scheme:')).every(line => line.endsWith(': missing'))).toBe(true);
  });
  it('uses only allowlisted error categories, not arbitrary messages or stacks', () => {
    const secret = randomBytes(32).toString('hex');
    const logs: string[] = [];
    const log = (message: string) => logs.push(message);
    logEnvValidationFailure(new Error(secret), log);
    logSigningKeyFailure(new Error(secret), log);
    logSigningKeyFailure(new SigningKeyConfigurationError('KEY_PAIR_MISMATCH'), log);
    const hostile = new SigningKeyConfigurationError('KEY_PAIR_INVALID');
    Object.assign(hostile, { code: secret });
    logSigningKeyFailure(hostile, log);
    expect(logs).toEqual([
      '[STARTUP] ENV validation failed', '[STARTUP] Signing key configuration failed: KEY_PAIR_INVALID',
      '[STARTUP] Signing key configuration failed: KEY_PAIR_MISMATCH', '[STARTUP] Signing key configuration failed: KEY_PAIR_INVALID',
    ]);
  });
  it.each([
    [['LICENSE_PRIVATE_KEY_BASE64'], 'PRIVATE_KEY_MISSING'],
    [['LICENSE_PUBLIC_KEY_PATH'], 'PUBLIC_KEY_MISSING'],
    [['LICENSE_PRIVATE_KEY_PATH', 'JWT_SECRET'], undefined],
  ] as const)('classifies ENV fields %j safely', (fields, code) => {
    const logs: string[] = [];
    logEnvValidationFailure(new EnvValidationError([...fields]), message => logs.push(message));
    expect(logs).toEqual(code ? [`[STARTUP] Signing key configuration failed: ${code}`] : [
      '[STARTUP] ENV validation failed', '[STARTUP] ENV invalid fields: JWT_SECRET, LICENSE_PRIVATE_KEY_PATH',
    ]);
  });
  it('reports missing PEM files by private/public category without exposing paths', () => {
    for (const [privatePath, publicPath, code] of [
      ['nonexistent-startup-private.pem', process.env.LICENSE_PUBLIC_KEY_PATH, 'PRIVATE_KEY_MISSING'],
      [process.env.LICENSE_PRIVATE_KEY_PATH, 'nonexistent-startup-public.pem', 'PUBLIC_KEY_MISSING'],
    ] as const) {
      let actualCode: string | undefined;
      try { loadSigningKeys(privatePath, publicPath); }
      catch (error) { if (error instanceof SigningKeyConfigurationError) actualCode = error.code; }
      expect(actualCode).toBe(code);
    }
  });
  it('reports only allowlisted invalid field names, ignoring arbitrary text', () => {
    const secret = randomBytes(32).toString('hex');
    const logs: string[] = [];
    logEnvValidationFailure(new EnvValidationError(['JWT_EXPIRES_IN', secret]), message => logs.push(message));
    expect(logs).toEqual(['[STARTUP] ENV validation failed', '[STARTUP] ENV invalid fields: JWT_EXPIRES_IN']);
  });
});

function runStartup(overrides: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/server.ts')], {
      env: { ...process.env, NODE_ENV: 'production', LICENSE_PRIVATE_KEY_PATH: '', LICENSE_PUBLIC_KEY_PATH: '', ...validKeys, ...overrides },
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Startup test timeout')); }, 15000);
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Startup test process failed')); });
    child.on('exit', code => { clearTimeout(timer); resolveResult({ code, output }); });
  });
}

function assertSafeFailure(result: { code: number | null; output: string }, message: string, secrets: string[] = []) {
  expect(result.code).toBe(1);
  expect(result.output.includes(message)).toBe(true);
  // Assert booleans so even a failing regression does not print captured secrets.
  const forbidden = [process.env.DATABASE_URL!, process.env.JWT_SECRET!, keys.privateKey, keys.publicKey, ...Object.values(validKeys), ...secrets];
  expect(forbidden.filter(Boolean).some(value => result.output.includes(value))).toBe(false);
  expect(/\bat (?:\S+ \()?[^\n]+:\d+:\d+/.test(result.output)).toBe(false);
}

describe('Real server process startup failures', () => {
  it.each([
    ['LICENSE_PRIVATE_KEY_PATH', 'PUBLIC_KEY_MISSING'],
    ['LICENSE_PUBLIC_KEY_PATH', 'PRIVATE_KEY_MISSING'],
  ])('rejects %s alone when no Base64 is configured', async (field, code) => {
    assertSafeFailure(await runStartup({ LICENSE_PRIVATE_KEY_BASE64: '', LICENSE_PUBLIC_KEY_BASE64: '', [field]: 'nonexistent-unused.pem' }), `[STARTUP] Signing key configuration failed: ${code}`);
  });
  it('identifies other invalid ENV fields without blaming absent PATHs in Base64 mode', async () => {
    const result = await runStartup({ JWT_EXPIRES_IN: 'invalid-duration' });
    assertSafeFailure(result, '[STARTUP] ENV validation failed', ['invalid-duration']);
    expect(result.output.includes('[STARTUP] ENV invalid fields: JWT_EXPIRES_IN')).toBe(true);
    expect(result.output.includes('Signing key configuration failed')).toBe(false);
  });
  it('reports invalid ENV without printing its input', async () => {
    const secret = randomBytes(32).toString('hex');
    assertSafeFailure(await runStartup({ DATABASE_URL: secret }), '[STARTUP] ENV validation failed', [secret]);
  });
  it.each([
    ['LICENSE_PRIVATE_KEY_BASE64', 'PRIVATE_KEY_MISSING'],
    ['LICENSE_PUBLIC_KEY_BASE64', 'PUBLIC_KEY_MISSING'],
  ])('reports missing %s before connecting to the database', async (field, code) => {
    assertSafeFailure(await runStartup({ [field]: '' }), `[STARTUP] Signing key configuration failed: ${code}`);
  });
  it('reports invalid PEM/Base64 as KEY_PAIR_INVALID', async () => {
    const invalid = base64(randomBytes(32).toString('hex'));
    assertSafeFailure(await runStartup({ LICENSE_PRIVATE_KEY_BASE64: invalid }), '[STARTUP] Signing key configuration failed: KEY_PAIR_INVALID', [invalid]);
  });
  it('reports mismatched Ed25519 keys as KEY_PAIR_MISMATCH', async () => {
    const other = generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const otherBase64 = base64(other.publicKey);
    assertSafeFailure(await runStartup({ LICENSE_PUBLIC_KEY_BASE64: otherBase64 }), '[STARTUP] Signing key configuration failed: KEY_PAIR_MISMATCH', [other.publicKey, otherBase64]);
  });
  it('reports a real refused PostgreSQL connection without printing credentials', async () => {
    const listener = createServer();
    await new Promise<void>((resolveReady, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolveReady); });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Test port allocation failed');
    await new Promise<void>((resolveClosed, reject) => listener.close(error => error ? reject(error) : resolveClosed()));
    const password = randomBytes(24).toString('hex');
    const url = `postgresql://startup_test:${password}@127.0.0.1:${address.port}/startup_test?connect_timeout=1`;
    assertSafeFailure(await runStartup({ DATABASE_URL: url }), '[STARTUP] Database connection failed', [url, password]);
  });
});

describe('Real server startup success using Base64', () => {
  it.each(['absent', 'invalid'] as const)('starts with %s PATHs and responds to /health using real PostgreSQL', async paths => {
    const listener = createServer();
    await new Promise<void>((ready, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', ready); });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('Test port allocation failed');
    const port = address.port;
    await new Promise<void>((closed, reject) => listener.close(error => error ? reject(error) : closed()));
    const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/server.ts')], {
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ...validKeys,
        LICENSE_PRIVATE_KEY_PATH: paths === 'absent' ? '' : 'nonexistent-invalid-private.pem',
        LICENSE_PUBLIC_KEY_PATH: paths === 'absent' ? '' : 'nonexistent-invalid-public.pem',
      }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const stopped = new Promise<void>(done => child.once('exit', () => done()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = new Promise<void>((resolveReady, reject) => {
      timer = setTimeout(() => reject(new Error('Startup success test timeout')), 10000);
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes(`central-licencas listening on port ${port}`)) resolveReady();
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.once('error', () => reject(new Error('Startup success process failed')));
      child.once('exit', () => reject(new Error('Startup success process exited before ready')));
    });
    try {
      await ready;
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, service: 'central-licencas' });
      expect(output.includes('[STARTUP] ENV validation failed')).toBe(false);
      expect([process.env.DATABASE_URL!, process.env.JWT_SECRET!, ...Object.values(validKeys)].some(secret => output.includes(secret))).toBe(false);
    } finally {
      if (timer) clearTimeout(timer);
      child.kill();
      await stopped;
    }
  });
});
