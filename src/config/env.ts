import 'dotenv/config';
import { z } from 'zod';

export function databaseUrlScheme(value: unknown): 'postgresql' | 'postgres' | 'invalid' {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value) || !/^postgres(?:ql)?:\/\//i.test(value)) return 'invalid';
  try {
    const url = new URL(value);
    if (!url.hostname || url.hash || /%(?![0-9a-f]{2})/i.test(value)) return 'invalid';
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) return 'invalid';
    // Only return fixed protocol labels, never any other URL component.
    if (url.protocol === 'postgresql:') return 'postgresql';
    if (url.protocol === 'postgres:') return 'postgres';
  } catch { /* Discard parser errors, which may contain the full input. */ }
  return 'invalid';
}

const optionalKeySetting = z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional());
const schema = z.preprocess(input => {
  if (typeof input !== 'object' || input === null) return input;
  const env = input as Record<string, unknown>;
  const hasBase64 = (typeof env.LICENSE_PRIVATE_KEY_BASE64 === 'string' && env.LICENSE_PRIVATE_KEY_BASE64.length > 0)
    || (typeof env.LICENSE_PUBLIC_KEY_BASE64 === 'string' && env.LICENSE_PUBLIC_KEY_BASE64.length > 0);
  // Choose the source BEFORE validating fields. A Base64 configuration must
  // never be rejected because of an unused PATH setting, even if it is invalid.
  return hasBase64 ? { ...env, LICENSE_PRIVATE_KEY_PATH: undefined, LICENSE_PUBLIC_KEY_PATH: undefined } : input;
}, z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).refine(value => databaseUrlScheme(value) !== 'invalid'),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default('8h'),
  LICENSE_PRIVATE_KEY_PATH: optionalKeySetting,
  LICENSE_PUBLIC_KEY_PATH: optionalKeySetting,
  LICENSE_PRIVATE_KEY_BASE64: optionalKeySetting,
  LICENSE_PUBLIC_KEY_BASE64: optionalKeySetting,
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  VALIDATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
}).superRefine((env, ctx) => {
  const hasBase64 = env.LICENSE_PRIVATE_KEY_BASE64 !== undefined || env.LICENSE_PUBLIC_KEY_BASE64 !== undefined;
  const required = hasBase64
    ? ['LICENSE_PRIVATE_KEY_BASE64', 'LICENSE_PUBLIC_KEY_BASE64'] as const
    : ['LICENSE_PRIVATE_KEY_PATH', 'LICENSE_PUBLIC_KEY_PATH'] as const;
  for (const field of required) {
    if (!env[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'Required signing key setting' });
  }
}));

export type Env = z.infer<typeof schema>;
export class EnvValidationError extends Error {
  constructor(public readonly fields: string[]) {
    super(`Invalid environment fields: ${fields.join(', ')}`);
  }
}
export function loadEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Only field names: never include environment values in errors.
    throw new EnvValidationError([...new Set(result.error.issues.map(i => i.path.join('.')))]);
  }
  return result.data;
}
