import { spawnSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

// Tests NEVER accept DATABASE_URL and NEVER touch an existing database.
// A dedicated container is created for this invocation, then removed by name.
const container = `central-licencas-test-${randomUUID()}`;
const tempRoot = realpathSync(tmpdir());
const directory = mkdtempSync(join(tempRoot, 'central-licencas-test-'));
const password = randomBytes(32).toString('hex');
let started = false;
const docker = args => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
function child(file, args, env) {
  return new Promise((resolveExit, reject) => {
    const processChild = spawn(file, args, { env, stdio: 'inherit', windowsHide: true });
    processChild.on('error', reject);
    processChild.on('exit', code => resolveExit(code ?? 1));
  });
}
try {
  if (docker(['info', '--format', '{{.ServerVersion}}']).status !== 0) throw new Error('DOCKER_UNAVAILABLE');
  console.log('Starting isolated PostgreSQL 17 (random credentials, no existing database).');
  const run = docker(['run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_USER=central_test', '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=central_test', 'postgres:17-alpine']);
  if (run.status !== 0) throw new Error('POSTGRES_START_FAILED');
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker(['exec', container, 'pg_isready', '-U', 'central_test', '-d', 'central_test']).status === 0) { ready = true; break; }
    await delay(1000);
  }
  if (!ready) throw new Error('POSTGRES_NOT_READY');
  const port = docker(['port', container, '5432/tcp']).stdout.trim().split(':').at(-1);
  if (!port || !/^\d+$/.test(port)) throw new Error('POSTGRES_PORT_UNAVAILABLE');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const privatePath = join(directory, 'private.pem');
  const publicPath = join(directory, 'public.pem');
  writeFileSync(privatePath, privateKey, { mode: 0o600 });
  writeFileSync(publicPath, publicKey);
  const env = {
    ...process.env, NODE_ENV: 'test', DATABASE_URL: `postgresql://central_test:${password}@127.0.0.1:${port}/central_test`,
    JWT_SECRET: randomBytes(48).toString('base64url'), JWT_EXPIRES_IN: '8h',
    LICENSE_PRIVATE_KEY_PATH: privatePath, LICENSE_PUBLIC_KEY_PATH: publicPath,
    LICENSE_PRIVATE_KEY_BASE64: '', LICENSE_PUBLIC_KEY_BASE64: '',
    CENTRAL_ISOLATED_TEST: 'true', RATE_LIMIT_MAX: '10000', LOGIN_RATE_LIMIT_MAX: '10000', VALIDATION_RATE_LIMIT_MAX: '10000',
  };
  if (await child(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], env) !== 0) throw new Error('MIGRATION_FAILED');
  process.exitCode = await child(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', ...process.argv.slice(2)], env);
} catch (error) {
  const safe = new Set(['DOCKER_UNAVAILABLE', 'POSTGRES_START_FAILED', 'POSTGRES_NOT_READY', 'POSTGRES_PORT_UNAVAILABLE', 'MIGRATION_FAILED']);
  console.error(`Test setup failed: ${safe.has(error?.message) ? error.message : 'SETUP_ERROR'}. Start Docker Desktop and retry npm test.`);
  process.exitCode = 1;
} finally {
  if (started) docker(['rm', '--force', container]);
  // Only the exact temp directory created by this process is removed.
  const target = resolve(directory);
  if (dirname(target) !== tempRoot || !basename(target).startsWith('central-licencas-test-')) throw new Error('Unsafe temporary cleanup path');
  rmSync(target, { recursive: true, force: true });
}
