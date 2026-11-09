-- Sports sessions, kinematic telemetry, and predictive model forecasts.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sports_sessions (
    session_id TEXT PRIMARY KEY,
    sport_type TEXT NOT NULL,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    match_status TEXT NOT NULL DEFAULT 'scheduled',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sports_sessions_status
    ON sports_sessions(match_status, created_at);

CREATE TABLE IF NOT EXISTS kinematic_metrics (
    metric_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    player_id TEXT NOT NULL,
    speed_mps REAL NOT NULL CHECK (speed_mps >= 0),
    acceleration_mps2 REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sports_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_kinematic_metrics_session_timestamp
    ON kinematic_metrics(session_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS predictive_models (
    model_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    model_version TEXT NOT NULL,
    win_probability_home REAL NOT NULL CHECK (win_probability_home BETWEEN 0 AND 1),
    win_probability_away REAL NOT NULL CHECK (win_probability_away BETWEEN 0 AND 1),
    confidence_score REAL NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sports_sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_predictive_models_session
    ON predictive_models(session_id, updated_at DESC);
