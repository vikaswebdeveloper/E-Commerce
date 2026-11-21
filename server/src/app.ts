import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { globalLimiter, originGuard } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { accountRouter } from './routes/account.js';
import { ordersRouter } from './routes/orders.js';
import { paymentsRouter } from './routes/payments.js';
import { adminRouter } from './routes/admin.js';
import { mockPayments } from './config.js';
import { isAllowedOrigin } from './lib/origin.js';
import { UPLOAD_DIR } from './services/storage.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || isAllowedOrigin(origin, config.clientOrigins, config.allowLanOrigins)),
      credentials: true,
    }),
  );

  // Webhook needs the raw bytes for signature verification, so it is parsed before express.json().
  app.use('/api/payments/webhook', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(originGuard);
  app.use('/api', globalLimiter());

  app.use(
    '/uploads',
    express.static(UPLOAD_DIR, {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
      },
    }),
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true, mockPayments }));
  app.use('/api/auth', authRouter);
  app.use('/api', catalogRouter);
  app.use('/api', accountRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
