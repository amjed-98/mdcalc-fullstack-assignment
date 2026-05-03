CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS heart_score_calculations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inputs JSONB NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  score SMALLINT NOT NULL CHECK (score >= 0 AND score <= 10),
  band TEXT NOT NULL CHECK (band IN ('low', 'moderate', 'high')),
  interpretation TEXT NOT NULL CHECK (length(interpretation) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS heart_score_calculations_created_at_idx
  ON heart_score_calculations (created_at DESC);
