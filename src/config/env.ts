import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine(v => /^postgres(ql)?:/.test(v)),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/).default('8h'),
  LICENSE_PRIVATE_KEY_PATH: z.string().min(1),
  LICENSE_PUBLIC_KEY_PATH: z.string().min(1),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  VALIDATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof schema>;
export function loadEnv(): Env {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Only field names: never include environment values in errors.
    throw new Error(`Invalid environment fields: ${[...new Set(result.error.issues.map(i => i.path.join('.')))].join(', ')}`);
  }
  return result.data;
}
