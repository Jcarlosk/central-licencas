import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { Context } from '../types/context.js';
import { loginBody } from '../utils/schemas.js';
import { ApiError } from '../utils/errors.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../middleware/auth.js';
// Same bcrypt work factor even for unknown emails. This is not an account.
const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), 12);
export function authRoutes({ db, env }: Context) {
  const router = Router();
  router.post('/login', async (req, res) => {
    const data = loginBody.parse(req.body);
    const admin = await db.admin.findUnique({ where: { email: data.email } });
    const valid = await bcrypt.compare(data.password, admin?.passwordHash ?? await dummyHash);
    if (!valid || !admin?.active) throw new ApiError(401, 'INVALID_CREDENTIALS');
    const token = jwt.sign({}, env.JWT_SECRET, { algorithm: 'HS256', subject: admin.id, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'] });
    res.json({ success: true, token, tokenType: 'Bearer', expiresIn: env.JWT_EXPIRES_IN });
  });
  return router;
}
