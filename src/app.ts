import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Context } from './types/context.js';
import { requireAdmin } from './middleware/auth.js';
import { errorHandler } from './middleware/errors.js';
import { authRoutes } from './routes/auth.routes.js';
import { clientsRoutes } from './routes/clients.routes.js';
import { productsRoutes } from './routes/products.routes.js';
import { installationsRoutes } from './routes/installations.routes.js';
import { licensesRoutes } from './routes/licenses.routes.js';
import { eventsRoutes } from './routes/events.routes.js';
import { publicLicenseRoutes } from './routes/public-license.routes.js';
function limiter(max: number) {
  return rateLimit({
    windowMs: 60_000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
    // Forwarded headers are intentionally ignored; avoid warning/stack logging
    // when an untrusted caller supplies one. req.ip remains the socket identity.
    validate: { xForwardedForHeader: false },
    message: { success: false, error: 'RATE_LIMITED' },
  });
}
export function createApp(ctx: Context) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet());
  app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_req, res) => { res.json({ success: true, service: 'central-licencas' }); });
  app.use('/api', limiter(ctx.env.RATE_LIMIT_MAX));
  app.use('/api/v1/auth', limiter(ctx.env.LOGIN_RATE_LIMIT_MAX));
  app.use('/api/v1/license', limiter(ctx.env.VALIDATION_RATE_LIMIT_MAX));
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use('/api/v1/auth', authRoutes(ctx));
  app.use('/api/v1/license', publicLicenseRoutes(ctx));
  const admin = express.Router();
  admin.use(requireAdmin(ctx));
  admin.use('/clients', clientsRoutes(ctx));
  admin.use('/products', productsRoutes(ctx));
  admin.use('/installations', installationsRoutes(ctx));
  admin.use('/licenses', licensesRoutes(ctx));
  admin.use('/events', eventsRoutes(ctx));
  app.use('/api/v1', admin);
  app.use((_req, res) => { res.status(404).json({ success: false, error: 'NOT_FOUND' }); });
  app.use(errorHandler);
  return app;
}
