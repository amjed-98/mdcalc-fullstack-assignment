import { Router } from 'express';

import { heartScoreRouter } from './heart-score/heart-score.router.js';

export const calculatorsRouter = Router();

calculatorsRouter.use('/heart-score', heartScoreRouter);
