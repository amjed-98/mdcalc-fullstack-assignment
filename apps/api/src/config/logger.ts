import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.API_LOG_LEVEL,
  base: { service: 'mdcalc-api' },
});

export type Logger = typeof logger;
