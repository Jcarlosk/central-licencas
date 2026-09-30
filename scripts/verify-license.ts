import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyLicense, signedLicenseSchema } from '../src/utils/signature.js';
import { z } from 'zod';
try {
  const responsePath = process.argv[2];
  const publicPath = process.argv[3] ?? 'keys/license-public.pem';
  if (!responsePath) throw new Error();
  const response = z.object({ success: z.literal(true), license: signedLicenseSchema, signature: z.string() }).strict().parse(JSON.parse(readFileSync(responsePath, 'utf8').replace(/^\uFEFF/, '')));
  const key = createPublicKey(readFileSync(publicPath));
  const valid = key.asymmetricKeyType === 'ed25519' && verifyLicense(response.license, response.signature, key);
  console.log(valid ? 'Assinatura válida.' : 'Assinatura inválida.');
  process.exitCode = valid ? 0 : 1;
} catch { console.error('Verificação falhou. Uso: npm run verify-license -- response.json keys/license-public.pem'); process.exitCode = 1; }
