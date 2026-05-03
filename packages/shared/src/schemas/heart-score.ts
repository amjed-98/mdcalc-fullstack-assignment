import { z } from 'zod';

/**
 * TODO(candidate): Define a zod schema that validates a HEART Score payload.
 *
 * Each of the five inputs (history, ecg, age, riskFactors, troponin) must be
 * constrained to the integer values 0, 1, or 2. See
 * `docs/heart-score-reference.md` for the allowed values per input.
 *
 * Export both the schema and its inferred type so the API and web layers
 * can share a single contract.
 */
export const heartScoreInputSchema = z.object({
  // TODO(candidate): replace with real fields
});

export type HeartScoreInput = z.infer<typeof heartScoreInputSchema>;
