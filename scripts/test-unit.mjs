import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';

// Only tests that do not connect to PostgreSQL. Never load the project's .env.
const root = realpathSync(tmpdir());
const directory = mkdtempSync(join(root, 'central-unit-test-'));
try {
  const keys = generateKeyPairSync('ed25519', { privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const privatePath = join(directory, 'private.pem'), publicPath = join(directory, 'public.pem');
  writeFileSync(privatePath, keys.privateKey, { mode: 0o600 }); writeFileSync(publicPath, keys.publicKey);
  const env = { ...process.env, NODE_ENV: 'test', DOTENV_CONFIG_PATH: join(directory, 'absent.env'), DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/central_unit', JWT_SECRET: randomBytes(48).toString('base64url'), JWT_EXPIRES_IN: '8h', LICENSE_PRIVATE_KEY_PATH: privatePath, LICENSE_PUBLIC_KEY_PATH: publicPath, LICENSE_PRIVATE_KEY_BASE64: '', LICENSE_PUBLIC_KEY_BASE64: '', RATE_LIMIT_MAX: '10000', LOGIN_RATE_LIMIT_MAX: '10000', VALIDATION_RATE_LIMIT_MAX: '10000' };
  process.exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/admin.test.ts', 'tests/policy.test.ts', 'tests/signing-keys.test.ts', 'tests/database-env.test.ts'], { env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => resolveExit(code ?? 1));
  });
} finally {
  const target = resolve(directory);
  if (dirname(target) !== root || !basename(target).startsWith('central-unit-test-')) throw new Error('Unsafe temporary cleanup path');
  rmSync(target, { recursive: true, force: true });
}
