import { describe, expect, it } from 'vitest';

import { calculateHeartScore } from './calculate';
import { heartScoreInputSchema, type HeartScoreInput } from '../../schemas/heart-score';

describe('calculateHeartScore', () => {
  it('returns the low-risk band for the minimum score', () => {
    const inputs: HeartScoreInput = { history: 0, ecg: 0, age: 0, riskFactors: 0, troponin: 0 };

    expect(calculateHeartScore(inputs)).toEqual({
      score: 0,
      band: 'low',
      interpretation: '0.9-1.7% 6-week MACE risk. Consider discharge.',
      inputs,
    });
  });

  it('returns the low-risk band through score 3', () => {
    const inputs: HeartScoreInput = { history: 1, ecg: 0, age: 1, riskFactors: 1, troponin: 0 };

    expect(calculateHeartScore(inputs)).toEqual({
      score: 3,
      band: 'low',
      interpretation: '0.9-1.7% 6-week MACE risk. Consider discharge.',
      inputs,
    });
  });

  it('returns the moderate-risk band for scores 4 through 6', () => {
    expect(
      calculateHeartScore({ history: 2, ecg: 0, age: 1, riskFactors: 1, troponin: 0 }),
    ).toMatchObject({
      score: 4,
      band: 'moderate',
      interpretation: '12-16.6% 6-week MACE risk. Admit for observation / further workup.',
    });

    expect(
      calculateHeartScore({ history: 2, ecg: 1, age: 1, riskFactors: 1, troponin: 1 }),
    ).toMatchObject({
      score: 6,
      band: 'moderate',
    });
  });

  it('returns the high-risk band from score 7', () => {
    expect(
      calculateHeartScore({ history: 2, ecg: 2, age: 1, riskFactors: 1, troponin: 1 }),
    ).toMatchObject({
      score: 7,
      band: 'high',
      interpretation: '50-65% 6-week MACE risk. Early invasive strategy.',
    });
  });

  it('returns the high-risk band for the maximum score', () => {
    const inputs: HeartScoreInput = { history: 2, ecg: 2, age: 2, riskFactors: 2, troponin: 2 };

    expect(calculateHeartScore(inputs)).toEqual({
      score: 10,
      band: 'high',
      interpretation: '50-65% 6-week MACE risk. Early invasive strategy.',
      inputs,
    });
  });
});

describe('heartScoreInputSchema', () => {
  it('rejects scored inputs outside the HEART range', () => {
    const result = heartScoreInputSchema.safeParse({
      history: 3,
      ecg: 0,
      age: 1,
      riskFactors: 1,
      troponin: 0,
    });

    expect(result.success).toBe(false);
  });
});
