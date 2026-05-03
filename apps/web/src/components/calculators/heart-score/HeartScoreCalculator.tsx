'use client';

/**
 * TODO(candidate):
 *   - Build a form with the five HEART Score inputs using the <RadioGroup />
 *     component from `@mdcalc/ui`.
 *   - Keep form state local (`useState` / `useReducer` — your call).
 *   - On every change, call `calculateHeartScore(input)` from `@mdcalc/shared`
 *     to render a live score + band + interpretation summary.
 *   - Add a "Save calculation" button that POSTs to the API via
 *     `createHeartScoreCalculation` from `@/lib/api/heart-score` and shows a
 *     success/error banner.
 *   - Trigger a refresh of the recent-calculations panel after a successful
 *     save (lift state or use a simple event bus — your call).
 *
 * Keep presentational concerns here; don't import from `pg` or `express`.
 */
export function HeartScoreCalculator() {
  return (
    <div
      style={{
        border: '1px dashed #9ca3af',
        borderRadius: 8,
        padding: '1.5rem',
        color: '#6b7280',
      }}
    >
      <strong>TODO:</strong> implement the HEART Score form and live result here.
    </div>
  );
}
