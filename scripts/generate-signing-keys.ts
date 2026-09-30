import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
function main() {
  const directory = resolve('keys');
  mkdirSync(directory, { recursive: true });
  const privatePath = resolve(directory, 'license-private.pem');
  const publicPath = resolve(directory, 'license-public.pem');
  if (existsSync(privatePath) || existsSync(publicPath)) throw new Error('Key files already exist; refusing to overwrite');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  writeFileSync(privatePath, privateKey, { flag: 'wx', mode: 0o600 });
  try { writeFileSync(publicPath, publicKey, { flag: 'wx', mode: 0o644 }); }
  catch (error) { unlinkSync(privatePath); throw error; }
  console.log('Created keys/license-private.pem and keys/license-public.pem. Keep the private key restricted to the service account.');
}
try { main(); } catch { console.error('Key generation failed. Existing keys are never overwritten.'); process.exitCode = 1; }
