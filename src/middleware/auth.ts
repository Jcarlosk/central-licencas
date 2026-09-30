import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Context } from '../types/context.js';
import { ApiError } from '../utils/errors.js';
import { uuid } from '../utils/schemas.js';
export const JWT_ISSUER = 'central-licencas';
export const JWT_AUDIENCE = 'central-licencas-admin';
export function requireAdmin({ db, env }: Context): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '');
    if (!match?.[1]) throw new ApiError(401, 'UNAUTHORIZED');
    let subject: string;
    try {
      const claims = jwt.verify(match[1], env.JWT_SECRET, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
      if (typeof claims === 'string' || !uuid.safeParse(claims.sub).success || typeof claims.exp !== 'number') throw new Error();
      subject = claims.sub!;
    } catch { throw new ApiError(401, 'UNAUTHORIZED'); }
    const admin = await db.admin.findUnique({ where: { id: subject }, select: { id: true, active: true } });
    if (!admin?.active) throw new ApiError(401, 'UNAUTHORIZED');
    res.locals.adminId = admin.id;
    next();
  };
}
