import { Router } from 'express';

import { heartScoreInputSchema } from '@mdcalc/shared';
import { validateBody } from '../../../middleware/validateBody.js';
import { heartScoreController } from './heart-score.controller.js';

export const heartScoreRouter = Router();

heartScoreRouter.post(
  '/calculate',
  validateBody(heartScoreInputSchema),
  heartScoreController.calculate,
);
heartScoreRouter.post(
  '/calculations',
  validateBody(heartScoreInputSchema),
  heartScoreController.create,
);
heartScoreRouter.get('/calculations', heartScoreController.list);
