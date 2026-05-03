import { z } from 'zod';

const scoredHeartInput = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const heartScoreInputSchema = z.object({
  history: scoredHeartInput,
  ecg: scoredHeartInput,
  age: scoredHeartInput,
  riskFactors: scoredHeartInput,
  troponin: scoredHeartInput,
});

export type HeartScoreInput = z.infer<typeof heartScoreInputSchema>;
