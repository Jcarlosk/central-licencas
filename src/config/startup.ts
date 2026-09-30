import { EnvValidationError } from './env.js';
import { SigningKeyConfigurationError } from '../utils/signature.js';

type Logger = (message: string) => void;
const keyFields = ['LICENSE_PRIVATE_KEY_BASE64', 'LICENSE_PUBLIC_KEY_BASE64', 'LICENSE_PRIVATE_KEY_PATH', 'LICENSE_PUBLIC_KEY_PATH'] as const;

export function logStartupConfiguration(env: NodeJS.ProcessEnv = process.env, log: Logger = console.log) {
  const mode = env.NODE_ENV === undefined ? 'development'
    : ['production', 'development', 'test'].includes(env.NODE_ENV) ? env.NODE_ENV : 'invalid';
  log(`[STARTUP] NODE_ENV: ${mode}`);
  for (const field of ['DATABASE_URL', 'JWT_SECRET', ...keyFields]) {
    log(`[STARTUP] ${field}: ${env[field] ? 'configured' : 'missing'}`);
  }
}

export function logEnvValidationFailure(error: unknown, log: Logger = console.error) {
  // Keep ENV validation intact, but classify missing key settings separately
  // when there are no other invalid environment fields.
  if (error instanceof EnvValidationError && error.fields.length > 0 && error.fields.every(field => keyFields.some(key => key === field))) {
    const privateMissing = error.fields.some(field => field === 'LICENSE_PRIVATE_KEY_BASE64' || field === 'LICENSE_PRIVATE_KEY_PATH');
    log(`[STARTUP] Signing key configuration failed: ${privateMissing ? 'PRIVATE_KEY_MISSING' : 'PUBLIC_KEY_MISSING'}`);
    return;
  }
  log('[STARTUP] ENV validation failed');
}

export function logSigningKeyFailure(error: unknown, log: Logger = console.error) {
  const allowed = ['KEY_PAIR_INVALID', 'KEY_PAIR_MISMATCH', 'PRIVATE_KEY_MISSING', 'PUBLIC_KEY_MISSING'];
  const code = error instanceof SigningKeyConfigurationError && allowed.includes(error.code) ? error.code : 'KEY_PAIR_INVALID';
  log(`[STARTUP] Signing key configuration failed: ${code}`);
}
