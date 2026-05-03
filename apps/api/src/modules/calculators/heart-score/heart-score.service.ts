import {
  calculateHeartScore,
  type HeartScoreInput,
  type HeartScoreResult,
  type PersistedHeartScoreCalculation,
} from '@mdcalc/shared';

import { heartScoreRepository } from './heart-score.repository.js';

export const heartScoreService = {
  calculate(input: HeartScoreInput): HeartScoreResult {
    return calculateHeartScore(input);
  },

  async createCalculation(input: HeartScoreInput): Promise<PersistedHeartScoreCalculation> {
    const result = calculateHeartScore(input);
    return heartScoreRepository.insert(input, result);
  },

  async listRecentCalculations(limit: number): Promise<PersistedHeartScoreCalculation[]> {
    return heartScoreRepository.listRecent(limit);
  },
};

export type HeartScoreService = typeof heartScoreService;
