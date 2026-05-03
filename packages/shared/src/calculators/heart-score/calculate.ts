import type { HeartScoreInput } from '../../schemas/heart-score';
import type { HeartScoreResult } from './types';

/**
 * Pure calculation for the HEART Score. Lives in the shared package so the
 * API and the web client can render the same live preview.
 *
 * TODO(candidate):
 *   1. Sum the five numeric inputs into `score`.
 *   2. Map the total to a `band` using the ranges in
 *      `docs/heart-score-reference.md`.
 *   3. Return a human-readable `interpretation` that mentions the 6-week
 *      MACE risk for that band.
 *
 * This function MUST NOT throw — it assumes its input has already been
 * validated against `heartScoreInputSchema`. Callers that accept untrusted
 * input should parse with the schema first.
 */
export function calculateHeartScore(_input: HeartScoreInput): HeartScoreResult {
  throw new Error('calculateHeartScore is not implemented yet');
}
