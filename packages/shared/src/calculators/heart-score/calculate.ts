import type { RiskBand } from '../../types/calculators';
import type { HeartScoreInput } from '../../schemas/heart-score';
import type { HeartScoreResult } from './types';

const bandInterpretations: Record<RiskBand, string> = {
  low: '0.9-1.7% 6-week MACE risk. Consider discharge.',
  moderate: '12-16.6% 6-week MACE risk. Admit for observation / further workup.',
  high: '50-65% 6-week MACE risk. Early invasive strategy.',
};

function getBand(score: number): RiskBand {
  if (score <= 3) {
    return 'low';
  }

  if (score <= 6) {
    return 'moderate';
  }

  return 'high';
}

export function calculateHeartScore(input: HeartScoreInput): HeartScoreResult {
  const score = input.history + input.ecg + input.age + input.riskFactors + input.troponin;
  const band = getBand(score);

  return {
    score,
    band,
    interpretation: bandInterpretations[band],
    inputs: input,
  };
}
