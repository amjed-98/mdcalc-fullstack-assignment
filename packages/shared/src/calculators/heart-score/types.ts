import type { CalculatorResult, PersistedCalculation } from '../../types/calculators';
import type { HeartScoreInput } from '../../schemas/heart-score';

export type HeartScoreResult = CalculatorResult<HeartScoreInput>;
export type PersistedHeartScoreCalculation = PersistedCalculation<HeartScoreInput>;
