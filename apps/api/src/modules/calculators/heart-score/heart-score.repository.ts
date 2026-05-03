import type {
  HeartScoreInput,
  HeartScoreResult,
  PersistedHeartScoreCalculation,
} from '@mdcalc/shared';
import { heartScoreInputSchema } from '@mdcalc/shared';

import { pool } from '../../../db/client.js';

interface HeartScoreCalculationRow {
  id: string;
  inputs: unknown;
  score: number;
  band: HeartScoreResult['band'];
  interpretation: string;
  created_at: string | Date;
}

function mapRow(row: HeartScoreCalculationRow): PersistedHeartScoreCalculation {
  return {
    id: row.id,
    inputs: heartScoreInputSchema.parse(row.inputs),
    score: row.score,
    band: row.band,
    interpretation: row.interpretation,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

export const heartScoreRepository = {
  async insert(
    input: HeartScoreInput,
    result: HeartScoreResult,
  ): Promise<PersistedHeartScoreCalculation> {
    const { rows } = await pool.query<HeartScoreCalculationRow>(
      `
        INSERT INTO heart_score_calculations (inputs, score, band, interpretation)
        VALUES ($1, $2, $3, $4)
        RETURNING id, inputs, score, band, interpretation, created_at
      `,
      [input, result.score, result.band, result.interpretation],
    );

    const [row] = rows;
    if (!row) {
      throw new Error('Insert did not return a HEART Score calculation');
    }

    return mapRow(row);
  },

  async listRecent(limit: number): Promise<PersistedHeartScoreCalculation[]> {
    const { rows } = await pool.query<HeartScoreCalculationRow>(
      `
        SELECT id, inputs, score, band, interpretation, created_at
        FROM heart_score_calculations
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [limit],
    );

    return rows.map(mapRow);
  },
};
