import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/client.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  closePool: vi.fn(),
}));

import { createApp } from '../../src/app.js';

describe('POST /api/v1/calculators/heart-score/calculate', () => {
  it('returns a calculated HEART Score result for valid scored inputs', async () => {
    const app = createApp();

    const res = await request(app).post('/api/v1/calculators/heart-score/calculate').send({
      history: 2,
      ecg: 1,
      age: 1,
      riskFactors: 1,
      troponin: 0,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      score: 5,
      band: 'moderate',
      interpretation: '12-16.6% 6-week MACE risk. Admit for observation / further workup.',
      inputs: {
        history: 2,
        ecg: 1,
        age: 1,
        riskFactors: 1,
        troponin: 0,
      },
    });
  });

  it('returns the structured validation error for invalid scored inputs', async () => {
    const app = createApp();

    const res = await request(app).post('/api/v1/calculators/heart-score/calculate').send({
      history: 2,
      ecg: 4,
      age: 1,
      riskFactors: 1,
      troponin: 0,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request payload failed validation',
    });
    expect(res.body.error.details.fieldErrors.ecg).toBeDefined();
  });
});
