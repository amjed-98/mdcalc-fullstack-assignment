import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { API_VERSION } from '@mdcalc/shared';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { healthRouter } from './modules/health/health.router.js';
import { calculatorsRouter } from './modules/calculators/calculators.router.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));

  app.use('/health', healthRouter);
  app.use(`/api/${API_VERSION}/calculators`, calculatorsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
