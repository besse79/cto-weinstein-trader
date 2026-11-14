-- Idempotent durable audit of automated research-only market data collection.
-- No migration of historic candles, positions or orders.
CREATE TABLE IF NOT EXISTS market_job_runs (
 id BIGSERIAL PRIMARY KEY,
 job_type TEXT NOT NULL CHECK(job_type IN ('BOOTSTRAP','EU_CLOSE','US_CLOSE')),
 business_day DATE NOT NULL,
 started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 finished_at TIMESTAMPTZ,
 status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCESS','PARTIAL','FAILED')),
 succeeded_symbols INTEGER NOT NULL DEFAULT 0,
 failed_symbols INTEGER NOT NULL DEFAULT 0,
 attempted_symbols INTEGER NOT NULL DEFAULT 0,
 message TEXT,
 details JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_market_job_runs_day_type ON market_job_runs(business_day,job_type,started_at DESC);
