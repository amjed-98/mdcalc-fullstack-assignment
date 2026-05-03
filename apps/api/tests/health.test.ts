import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/db/client.js', () => ({
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  closePool: vi.fn(),
}));

import { createApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns ok when the DB responds', async () => {
    const app = createApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
  });
});
