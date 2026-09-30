import { z } from 'zod';
const name = z.string().trim().min(1).max(200);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
export const uuid = z.uuid();
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export const clientCreate = z.object({ name, document: optionalText(50), email: z.email().max(254).toLowerCase().nullable().optional(), phone: optionalText(50), active: z.boolean().optional() }).strict();
export const productCreate = z.object({ name, code: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: optionalText(2000), active: z.boolean().optional() }).strict();
export const installationCreate = z.object({
  clientId: uuid, productId: uuid, name,
  installationId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
  active: z.boolean().optional(),
}).strict();
export const installationPatch = z.object({ name: name.optional(), active: z.boolean().optional() }).strict().refine(v => Object.keys(v).length > 0);
export const clientPatch = clientCreate.partial().refine(v => Object.keys(v).length > 0);
export const productPatch = productCreate.partial().refine(v => Object.keys(v).length > 0);
export const daysSchema = z.object({ days: z.number().int().min(1).max(3650), graceDays: z.number().int().min(0).max(365).default(5) }).strict();
export const licenseCreate = daysSchema.extend({ installationId: uuid, notes: optionalText(2000) }).strict();
export const actionBody = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict();
export const loginBody = z.object({ email: z.email().max(254).toLowerCase(), password: z.string().min(1).refine(v => Buffer.byteLength(v, 'utf8') <= 72) }).strict();
export const adminInput = z.object({ name, email: z.email().max(254).toLowerCase(), password: z.string().min(12).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Senha deve ter no máximo 72 bytes UTF-8') }).strict();
export const validationBody = z.object({ installationId: z.string().min(1).max(100), installationSecret: z.string().min(1).max(256) }).strict();
export function paged<T>(data: T[], total: number, page: number, limit: number) { return { success: true, data, pagination: { total, page, limit } }; }
