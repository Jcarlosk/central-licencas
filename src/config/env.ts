import 'dotenv/config';
import { z } from 'zod';

const optionalKeySetting = z.preprocess(value => value === '' ? undefined : value, z.string().min(1).optional());
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine(v => /^postgres(ql)?:/.test(v)),
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
});

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
