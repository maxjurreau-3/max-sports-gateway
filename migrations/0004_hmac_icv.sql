-- ICV state and HMAC request nonce replay protection.
CREATE TABLE IF NOT EXISTS identity_curvature_states (
    icv_id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL UNIQUE,
    curvature_matrix TEXT NOT NULL CHECK (json_valid(curvature_matrix)),
    alignment_score REAL NOT NULL CHECK (alignment_score BETWEEN 0 AND 1),
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hmac_request_nonces (
    nonce TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hmac_request_nonces_timestamp
    ON hmac_request_nonces(timestamp);
