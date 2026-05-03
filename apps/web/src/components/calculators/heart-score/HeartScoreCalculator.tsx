'use client';

import React, { useMemo, useState } from 'react';

import { calculateHeartScore, type HeartScoreInput } from '@mdcalc/shared';
import { Button, Card, RadioGroup, type RadioOption } from '@mdcalc/ui';

import { RecentCalculations } from './RecentCalculations';
import { createHeartScoreCalculation } from '../../../lib/api/heart-score';

type HeartScoreField = keyof HeartScoreInput;
type HeartScoreValue = HeartScoreInput[HeartScoreField];

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

interface HeartScoreCategory {
  field: HeartScoreField;
  legend: string;
  helperText: string;
  options: ReadonlyArray<RadioOption<HeartScoreValue>>;
}

const defaultInput: HeartScoreInput = {
  history: 0,
  ecg: 0,
  age: 0,
  riskFactors: 0,
  troponin: 0,
};

const categories: ReadonlyArray<HeartScoreCategory> = [
  {
    field: 'history',
    legend: 'History',
    helperText: 'Clinical suspicion from the presenting story.',
    options: [
      { value: 0, label: 'Slightly suspicious' },
      { value: 1, label: 'Moderately suspicious' },
      { value: 2, label: 'Highly suspicious' },
    ],
  },
  {
    field: 'ecg',
    legend: 'ECG',
    helperText: 'Initial ECG findings.',
    options: [
      { value: 0, label: 'Normal' },
      { value: 1, label: 'Nonspecific repolarization disturbance' },
      { value: 2, label: 'Significant ST deviation' },
    ],
  },
  {
    field: 'age',
    legend: 'Age',
    helperText: 'Patient age at presentation.',
    options: [
      { value: 0, label: '<45 years' },
      { value: 1, label: '45-64 years' },
      { value: 2, label: '>=65 years' },
    ],
  },
  {
    field: 'riskFactors',
    legend: 'Risk factors',
    helperText: 'Cardiac risk factor burden.',
    options: [
      { value: 0, label: 'No known risk factors' },
      { value: 1, label: '1-2 risk factors' },
      { value: 2, label: '>=3 risk factors or known atherosclerotic disease' },
    ],
  },
  {
    field: 'troponin',
    legend: 'Troponin',
    helperText: 'Initial troponin relative to the local normal limit.',
    options: [
      { value: 0, label: '<= normal limit' },
      { value: 1, label: '1-3x normal limit' },
      { value: 2, label: '>3x normal limit' },
    ],
  },
];

export function HeartScoreCalculator() {
  const [input, setInput] = useState<HeartScoreInput>(defaultInput);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const [refreshToken, setRefreshToken] = useState(0);

  const result = useMemo(() => calculateHeartScore(input), [input]);
  const isSaving = saveState.status === 'saving';

  function updateInput(field: HeartScoreField, value: HeartScoreValue) {
    setInput((current) => ({ ...current, [field]: value }));
    if (saveState.status !== 'idle') {
      setSaveState({ status: 'idle' });
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveState({ status: 'saving' });

    try {
      const saved = await createHeartScoreCalculation(input);
      setSaveState({
        status: 'success',
        message: `Saved calculation ${saved.score} (${saved.band}).`,
      });
      setRefreshToken((current) => current + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unable to save calculation';
      setSaveState({ status: 'error', message });
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div
        style={{
          alignItems: 'start',
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
        }}
      >
        <Card title="Calculator">
          <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1.25rem' }}>
            {categories.map((category) => (
              <RadioGroup
                key={category.field}
                name={category.field}
                legend={category.legend}
                helperText={category.helperText}
                value={input[category.field]}
                options={category.options}
                onChange={(value) => updateInput(category.field, value)}
              />
            ))}

            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save calculation'}
              </Button>

              {saveState.status === 'success' ? (
                <p role="status" style={{ color: '#047857', margin: 0 }}>
                  {saveState.message}
                </p>
              ) : null}

              {saveState.status === 'error' ? (
                <p role="alert" style={{ color: '#b91c1c', margin: 0 }}>
                  {saveState.message}
                </p>
              ) : null}
            </div>
          </form>
        </Card>

        <Card title="Live result">
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ alignItems: 'baseline', display: 'flex', gap: '0.75rem' }}>
              <strong style={{ fontSize: '2rem' }}>Score {result.score}</strong>
              <span style={{ color: '#374151', fontWeight: 600, textTransform: 'capitalize' }}>
                {result.band}
              </span>
            </div>
            <p style={{ color: '#374151', margin: 0 }}>{result.interpretation}</p>
          </div>
        </Card>
      </div>

      <RecentCalculations refreshToken={refreshToken} />
    </div>
  );
}
