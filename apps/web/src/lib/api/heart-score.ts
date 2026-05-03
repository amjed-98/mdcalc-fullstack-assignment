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
export async function calculateHeartScoreRemote(
  input: HeartScoreInput,
): Promise<HeartScoreResult> {
  return apiFetch<HeartScoreResult>(`${BASE}/calculate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function createHeartScoreCalculation(
  input: HeartScoreInput,
): Promise<PersistedHeartScoreCalculation> {
  return apiFetch<PersistedHeartScoreCalculation>(`${BASE}/calculations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listHeartScoreCalculations(
  limit = 20,
): Promise<PersistedHeartScoreCalculation[]> {
  return apiFetch<PersistedHeartScoreCalculation[]>(`${BASE}/calculations?limit=${limit}`);
}
