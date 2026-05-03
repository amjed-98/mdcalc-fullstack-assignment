import { Router } from 'express';

import { pool } from '../../db/client.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const db = await pool
    .query('SELECT 1')
    .then(() => 'ok' as const)
    .catch(() => 'down' as const);

  res.json({ status: 'ok', db, uptime: process.uptime() });
});
