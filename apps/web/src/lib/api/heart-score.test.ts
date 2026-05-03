import { afterEach, describe, expect, it, vi } from 'vitest';

import { listHeartScoreCalculations } from './heart-score';

describe('listHeartScoreCalculations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches recent HEART Score calculations through the shared API client', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          id: '018f190f-0dc8-7487-b35d-123456789abc',
          inputs: {
            history: 2,
            ecg: 1,
            age: 1,
            riskFactors: 1,
            troponin: 0,
          },
          score: 5,
          band: 'moderate',
          interpretation: '12-16.6% 6-week MACE risk. Admit for observation / further workup.',
          createdAt: '2026-05-03T10:00:00.000Z',
        },
      ]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const calculations = await listHeartScoreCalculations(3);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/calculators/heart-score/calculations?limit=3',
      expect.objectContaining({
        headers: expect.objectContaining({ 'content-type': 'application/json' }),
      }),
    );
    expect(calculations).toHaveLength(1);
    expect(calculations[0]).toMatchObject({
      id: '018f190f-0dc8-7487-b35d-123456789abc',
      score: 5,
      band: 'moderate',
      createdAt: '2026-05-03T10:00:00.000Z',
    });
  });
});
