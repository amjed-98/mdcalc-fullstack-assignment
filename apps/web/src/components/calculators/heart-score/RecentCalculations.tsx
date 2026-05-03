'use client';

import { useEffect, useState } from 'react';

import type { PersistedHeartScoreCalculation } from '@mdcalc/shared';
import { Card } from '@mdcalc/ui';

import { listHeartScoreCalculations } from '@/lib/api/heart-score';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; calculations: PersistedHeartScoreCalculation[] };

const inputLabels: Array<[keyof PersistedHeartScoreCalculation['inputs'], string]> = [
  ['history', 'History'],
  ['ecg', 'ECG'],
  ['age', 'Age'],
  ['riskFactors', 'Risk factors'],
  ['troponin', 'Troponin'],
];

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatInputs(calculation: PersistedHeartScoreCalculation) {
  return inputLabels.map(([key, label]) => `${label} ${calculation.inputs[key]}`).join(' | ');
}

export function RecentCalculations({ refreshToken = 0 }: { refreshToken?: number }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let isCurrent = true;
    setState({ status: 'loading' });

    listHeartScoreCalculations()
      .then((calculations) => {
        if (isCurrent) {
          setState({ status: 'success', calculations });
        }
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          const message = err instanceof Error ? err.message : 'Unable to load recent calculations';
          setState({ status: 'error', message });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [refreshToken]);

  return (
    <Card title="Recent calculations">
      {state.status === 'loading' ? (
        <p style={{ color: '#6b7280', margin: 0 }}>Loading recent calculations...</p>
      ) : null}

      {state.status === 'error' ? (
        <p role="alert" style={{ color: '#b91c1c', margin: 0 }}>
          {state.message}
        </p>
      ) : null}

      {state.status === 'success' && state.calculations.length === 0 ? (
        <p style={{ color: '#6b7280', margin: 0 }}>No saved calculations yet.</p>
      ) : null}

      {state.status === 'success' && state.calculations.length > 0 ? (
        <ul style={{ display: 'grid', gap: '0.75rem', listStyle: 'none', margin: 0, padding: 0 }}>
          {state.calculations.map((calculation) => (
            <li
              key={calculation.id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                display: 'grid',
                gap: '0.375rem',
                padding: '0.875rem',
              }}
            >
              <div style={{ alignItems: 'baseline', display: 'flex', gap: '0.75rem' }}>
                <strong>Score {calculation.score}</strong>
                <span style={{ color: '#374151', textTransform: 'capitalize' }}>
                  {calculation.band}
                </span>
                <time
                  dateTime={calculation.createdAt}
                  style={{ color: '#6b7280', marginLeft: 'auto' }}
                >
                  {formatCreatedAt(calculation.createdAt)}
                </time>
              </div>
              <p style={{ color: '#374151', margin: 0 }}>{calculation.interpretation}</p>
              <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
                {formatInputs(calculation)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
