-- MAX-SPORTS sovereign D1 schema.
-- Credits are represented as REAL to allow fractional model costs; handlers should
-- use atomic conditional updates when charging balances to avoid concurrent overspend.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_credits (
    user_id TEXT PRIMARY KEY,
    tier TEXT NOT NULL DEFAULT 'free'
        CHECK (tier IN ('free', 'pro', 'sovereign', 'admin')),
    balance REAL NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    lifetime_spent REAL NOT NULL DEFAULT 0.00 CHECK (lifetime_spent >= 0),
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_credits_tier
    ON user_credits(tier);

CREATE TABLE IF NOT EXISTS model_queries (
    query_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    parameters_json TEXT NOT NULL CHECK (json_valid(parameters_json)),
    result_summary_json TEXT CHECK (
        result_summary_json IS NULL OR json_valid(result_summary_json)
    ),
    execution_time_ms INTEGER NOT NULL CHECK (execution_time_ms >= 0),
    credit_cost REAL NOT NULL CHECK (credit_cost >= 0),
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user_credits(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_queries_user
    ON model_queries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_queries_model
    ON model_queries(model_name, created_at DESC);

CREATE TABLE IF NOT EXISTS telemetry_events (
    event_id TEXT PRIMARY KEY,
    user_id TEXT,
    node_id TEXT NOT NULL DEFAULT 'max-sports-gateway',
    metric_type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES user_credits(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp
    ON telemetry_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_telemetry_metric
    ON telemetry_events(metric_type, timestamp DESC);
