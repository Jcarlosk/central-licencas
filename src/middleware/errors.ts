import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/errors.js';
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ApiError) { res.status(error.status).json({ success: false, error: error.code }); return; }
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR', fields: error.issues.map(i => ({ path: i.path.join('.'), code: i.code })) }); return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const codes: Record<string, [number, string]> = { P2002: [409, 'CONFLICT'], P2003: [400, 'INVALID_RELATION'], P2025: [404, 'NOT_FOUND'], P2034: [409, 'RETRY_OPERATION'] };
    const mapped = codes[error.code];
    if (mapped) { res.status(mapped[0]).json({ success: false, error: mapped[1] }); return; }
  }
  const httpError = error as { type?: string; status?: number };
  if (httpError?.type === 'entity.too.large') { res.status(413).json({ success: false, error: 'BODY_TOO_LARGE' }); return; }
  if (httpError?.type === 'entity.parse.failed') { res.status(400).json({ success: false, error: 'INVALID_JSON' }); return; }
  // Never log request bodies, Prisma errors, headers, credentials, or stack traces.
  console.error('Request failed: INTERNAL_ERROR');
  res.status(500).json({ success: false, error: 'INTERNAL_ERROR' });
};
