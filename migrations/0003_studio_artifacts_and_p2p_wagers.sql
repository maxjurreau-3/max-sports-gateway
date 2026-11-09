-- Studio nonce replay protection, artifact manifests, and peer-to-peer wagers.
-- This is migration 0003 because migrations 0001 and 0002 already exist.

CREATE TABLE IF NOT EXISTS studio_nonces (
    identity TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY (identity, nonce)
);

CREATE TABLE IF NOT EXISTS art_manifests (
    canonical_hash TEXT PRIMARY KEY,
    creator_identity TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS p2p_wagers (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL,
    maker_identity TEXT NOT NULL,
    metric TEXT NOT NULL,
    line_value REAL NOT NULL,
    stake REAL NOT NULL,
    status TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
