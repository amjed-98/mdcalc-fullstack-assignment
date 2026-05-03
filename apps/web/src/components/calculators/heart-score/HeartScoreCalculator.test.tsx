import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HeartScoreCalculator } from './HeartScoreCalculator';

describe('HeartScoreCalculator', () => {
  it('renders the HEART categories and an initial live result', () => {
    const html = renderToStaticMarkup(<HeartScoreCalculator />);

    expect(html).toContain('History');
    expect(html).toContain('ECG');
    expect(html).toContain('Age');
    expect(html).toContain('Risk factors');
    expect(html).toContain('Troponin');
    expect(html).toContain('Score 0');
    expect(
      html
        .match(/<strong[^>]*>Score 0<\/strong><span[^>]*>\s*([^<]+)\s*<\/span>/)?.[1]
        ?.trim(),
    ).toBe('low');
    expect(html).toContain('0.9-1.7% 6-week MACE risk');
  });
});
