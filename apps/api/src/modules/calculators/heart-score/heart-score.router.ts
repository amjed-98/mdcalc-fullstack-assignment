import { Router } from 'express';

import { heartScoreInputSchema } from '@mdcalc/shared';
import { validateBody } from '../../../middleware/validateBody.js';
import { heartScoreController } from './heart-score.controller.js';

export const heartScoreRouter = Router();

/**
 * TODO(candidate): wire the three endpoints described in ASSIGNMENT.md.
 *
 * - POST   /calculate       -> controller.calculate
 * - POST   /calculations    -> controller.create
 * - GET    /calculations    -> controller.list
 *
 * Use `validateBody(heartScoreInputSchema)` on the POST routes once the
 * schema is implemented. The GET route should validate its query params
 * (limit: optional int, 1..100, default 20).
 */
heartScoreRouter.post('/calculate', validateBody(heartScoreInputSchema), heartScoreController.calculate);

// heartScoreRouter.post('/calculations', validateBody(heartScoreInputSchema), heartScoreController.create);
// heartScoreRouter.get('/calculations', heartScoreController.list);
