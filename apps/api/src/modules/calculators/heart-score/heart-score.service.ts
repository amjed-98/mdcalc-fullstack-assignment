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

  async listRecentCalculations(_limit: number): Promise<PersistedHeartScoreCalculation[]> {
    // TODO(candidate): delegate to `heartScoreRepository.listRecent(limit)`
    throw new Error('not implemented');
  },
};

export type HeartScoreService = typeof heartScoreService;
