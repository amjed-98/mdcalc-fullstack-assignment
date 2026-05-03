export const API_VERSION = 'v1' as const;

export const CALCULATOR_SLUGS = {
  heartScore: 'heart-score',
} as const;

export type CalculatorSlug = (typeof CALCULATOR_SLUGS)[keyof typeof CALCULATOR_SLUGS];
