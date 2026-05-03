import type { Request, Response, NextFunction } from 'express';

import { HttpError } from '../../../utils/httpError.js';
import { heartScoreService } from './heart-score.service.js';

const DEFAULT_RECENT_CALCULATIONS_LIMIT = 20;
const MAX_RECENT_CALCULATIONS_LIMIT = 100;

function parseRecentCalculationsLimit(rawLimit: Request['query'][string]): number {
  if (rawLimit === undefined) {
    return DEFAULT_RECENT_CALCULATIONS_LIMIT;
  }

  if (Array.isArray(rawLimit) || typeof rawLimit !== 'string') {
    throw HttpError.badRequest('Limit must be an integer from 1 to 100');
  }

  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT_CALCULATIONS_LIMIT) {
    throw HttpError.badRequest('Limit must be an integer from 1 to 100');
  }

  return limit;
}

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

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const calculation = await heartScoreService.createCalculation(req.body);
      res.status(201).json(calculation);
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = parseRecentCalculationsLimit(req.query.limit);
      const calculations = await heartScoreService.listRecentCalculations(limit);
      res.status(200).json(calculations);
    } catch (err) {
      next(err);
    }
  },
};
