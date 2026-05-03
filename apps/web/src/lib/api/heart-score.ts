import type {
  HeartScoreInput,
  HeartScoreResult,
  PersistedHeartScoreCalculation,
} from '@mdcalc/shared';

import { apiFetch } from './client';

const BASE = '/api/v1/calculators/heart-score';

/**
 * TODO(candidate): implement these three helpers against the endpoints you
 * build in the API. They are the only functions the UI should use to talk
 * to the API for this feature.
 */
export async function calculateHeartScoreRemote(_input: HeartScoreInput): Promise<HeartScoreResult> {
  throw new Error('not implemented');
}

export async function createHeartScoreCalculation(
  _input: HeartScoreInput,
): Promise<PersistedHeartScoreCalculation> {
  throw new Error('not implemented');
}

export async function listHeartScoreCalculations(
  _limit = 20,
): Promise<PersistedHeartScoreCalculation[]> {
  throw new Error('not implemented');
}

// Keep the import referenced until the candidate wires it up.
void BASE;
void apiFetch;
