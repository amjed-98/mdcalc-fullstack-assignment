import type { Request, Response, NextFunction } from 'express';

import { heartScoreService } from './heart-score.service.js';

/**
 * Thin HTTP layer. All calculation and persistence logic lives in the
 * service. Keep controller bodies short and side-effect-free beyond
 * translating between the request/response and service calls.
 */
export const heartScoreController = {
  async calculate(req: Request, res: Response, next: NextFunction) {
    try {
      const result = heartScoreService.calculate(req.body);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  // TODO(candidate): implement `create` (POST /calculations) and
  // `list`     (GET  /calculations).
};
