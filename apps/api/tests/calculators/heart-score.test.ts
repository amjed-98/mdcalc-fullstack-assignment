import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../../src/db/client.js', () => ({
  pool: { query: db.query },
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

describe('POST /api/v1/calculators/heart-score/calculations', () => {
  it('recomputes and persists a HEART Score calculation from valid scored inputs', async () => {
    const app = createApp();
    db.query.mockResolvedValueOnce({
      rows: [
        {
          id: '018f190f-0dc8-7487-b35d-123456789abc',
          inputs: {
            history: 2,
            ecg: 2,
            age: 1,
            riskFactors: 1,
            troponin: 1,
          },
          score: 7,
          band: 'high',
          interpretation: '50-65% 6-week MACE risk. Early invasive strategy.',
          created_at: '2026-05-03T10:00:00.000Z',
        },
      ],
    });

    const res = await request(app).post('/api/v1/calculators/heart-score/calculations').send({
      history: 2,
      ecg: 2,
      age: 1,
      riskFactors: 1,
      troponin: 1,
      score: 0,
      band: 'low',
      interpretation: 'client supplied result should be ignored',
    });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: '018f190f-0dc8-7487-b35d-123456789abc',
      inputs: {
        history: 2,
        ecg: 2,
        age: 1,
        riskFactors: 1,
        troponin: 1,
      },
      score: 7,
      band: 'high',
      interpretation: '50-65% 6-week MACE risk. Early invasive strategy.',
      createdAt: '2026-05-03T10:00:00.000Z',
    });
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [
      {
        history: 2,
        ecg: 2,
        age: 1,
        riskFactors: 1,
        troponin: 1,
      },
      7,
      'high',
      '50-65% 6-week MACE risk. Early invasive strategy.',
    ]);
  });

  it('returns the structured validation error without persisting invalid scored inputs', async () => {
    const app = createApp();
    db.query.mockClear();

    const res = await request(app).post('/api/v1/calculators/heart-score/calculations').send({
      history: 2,
      ecg: 1,
      age: 3,
      riskFactors: 1,
      troponin: 0,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request payload failed validation',
    });
    expect(res.body.error.details.fieldErrors.age).toBeDefined();
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/calculators/heart-score/calculations', () => {
  it('returns the 20 most recent saved HEART Score calculations by default', async () => {
    const app = createApp();
    db.query.mockResolvedValueOnce({
      rows: [
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
          created_at: '2026-05-03T10:00:00.000Z',
        },
      ],
    });

    const res = await request(app).get('/api/v1/calculators/heart-score/calculations');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
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
    ]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at DESC'),
      [20],
    );
  });

  it('uses a valid explicit recent-calculation limit', async () => {
    const app = createApp();
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/v1/calculators/heart-score/calculations?limit=3');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('LIMIT $1'), [3]);
  });

  it.each(['0', '101', '2.5', 'recent'])(
    'rejects invalid recent-calculation limit %s',
    async (limit) => {
      const app = createApp();
      db.query.mockClear();

      const res = await request(app).get(
        `/api/v1/calculators/heart-score/calculations?limit=${limit}`,
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'Limit must be an integer from 1 to 100',
      });
      expect(db.query).not.toHaveBeenCalled();
    },
  );
});
