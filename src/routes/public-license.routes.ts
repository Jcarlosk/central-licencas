import { Router } from 'express';
import type { Context } from '../types/context.js';
import { validationBody } from '../utils/schemas.js';
import { validateLicense } from '../services/licenses.js';
export function publicLicenseRoutes(ctx: Context) {
  const router = Router();
  router.post('/validate', async (req, res) => { res.json(await validateLicense(ctx, validationBody.parse(req.body))); });
  return router;
}
