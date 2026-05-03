/**
 * Cross-calculator primitives. Per-calculator input/result types live in
 * `packages/shared/src/calculators/<slug>/types.ts` and are re-exported from
 * the package entrypoint.
 */

export type RiskBand = 'low' | 'moderate' | 'high';

export interface CalculatorResult<TInputs> {
  score: number;
  band: RiskBand;
  interpretation: string;
  inputs: TInputs;
}

export interface PersistedCalculation<TInputs> extends CalculatorResult<TInputs> {
  id: string;
  createdAt: string;
}
