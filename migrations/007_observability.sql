-- Operator-facing operational observability. Distinct from opt-in member
-- analytics: no message content, no profile answers, no marketing reporting.
CREATE TABLE observability_events (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  actor_id TEXT,
  outcome TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  detail JSONB
);
CREATE INDEX observability_events_kind_ts ON observability_events(kind, ts DESC);
CREATE INDEX observability_events_ts ON observability_events(ts DESC);
CREATE INDEX observability_events_outcome ON observability_events(outcome, ts DESC) WHERE outcome IS NOT NULL;
