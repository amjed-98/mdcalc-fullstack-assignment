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

  async createCalculation(_input: HeartScoreInput): Promise<PersistedHeartScoreCalculation> {
    // TODO(candidate):
    //   1. calculate the score via `calculateHeartScore`
    //   2. persist via `heartScoreRepository.insert(...)`
    //   3. return the persisted row
    throw new Error('not implemented');
  },

  async listRecentCalculations(_limit: number): Promise<PersistedHeartScoreCalculation[]> {
    // TODO(candidate): delegate to `heartScoreRepository.listRecent(limit)`
    throw new Error('not implemented');
  },
};

export type HeartScoreService = typeof heartScoreService;
// Keep the import even if unused until the candidate wires it up.
void heartScoreRepository;
