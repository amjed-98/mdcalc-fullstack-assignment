import type {
  HeartScoreInput,
  HeartScoreResult,
  PersistedHeartScoreCalculation,
} from '@mdcalc/shared';

import { pool } from '../../../db/client.js';

/**
 * Data-access layer for `heart_score_calculations`. The service should be
 * the only caller — keep SQL and row-to-DTO mapping inside this file.
 *
 * TODO(candidate): implement `insert` and `listRecent` against the table
 * created in `src/db/migrations/002_heart_score_calculations.sql`.
 */
export const heartScoreRepository = {
  async insert(_input: HeartScoreInput, _result: HeartScoreResult): Promise<PersistedHeartScoreCalculation> {
    throw new Error('not implemented');
  },

  async listRecent(_limit: number): Promise<PersistedHeartScoreCalculation[]> {
    throw new Error('not implemented');
  },
};

// Placeholder so editors don't flag `pool` as unused while the repository
// is stubbed. Safe to remove once the queries above are implemented.
void pool;
