import { Hono, type MiddlewareHandler } from 'hono';

export interface SportsApiEnv {
  DB: D1Database;
  HMAC_SECRET: string;
  SPORTS_TELEMETRY_DO: DurableObjectNamespace;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TIME_DRIFT_MS = 5 * 60 * 1000;
const app = new Hono<{ Bindings: SportsApiEnv }>();

function decodeHex(value: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2}){32}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export const hmacAuthMiddleware: MiddlewareHandler<{ Bindings: SportsApiEnv }> = async (c, next) => {
  const signature = c.req.header('X-Signature');
  const timestampHeader = c.req.header('X-Timestamp');
  const nonce = c.req.header('X-Nonce');
  const secret = c.env.HMAC_SECRET;

  if (!signature || !timestampHeader || !nonce) {
    return c.json({ success: false, error: 'Missing HMAC authentication headers' }, 401);
  }
  if (!/^\d{13}$/.test(timestampHeader) || !/^[0-9a-f-]{36}$/i.test(nonce)) {
    return c.json({ success: false, error: 'Invalid HMAC authentication headers' }, 401);
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > MAX_TIME_DRIFT_MS) {
    return c.json({ success: false, error: 'Request timestamp expired' }, 401);
  }
  const signatureBytes = decodeHex(signature);
  if (!signatureBytes) return c.json({ success: false, error: 'Invalid HMAC signature format' }, 401);
  if (!secret || secret.length < 32) {
    console.error('HMAC_SECRET is missing or too short');
    return c.json({ success: false, error: 'Authentication is not configured' }, 503);
  }

  try {
    const rawBody = await c.req.raw.clone().text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return c.json({ success: false, error: 'Request body too large' }, 413);
    }

    // Sign the exact request URL, method and body; client and server must use this canonical form.
    const canonical = `${timestampHeader}:${nonce}:${c.req.method.toUpperCase()}:${c.req.url}:${rawBody}`;
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, signatureBytes, new TextEncoder().encode(canonical),
    );
    if (!valid) return c.json({ success: false, error: 'Invalid HMAC signature' }, 401);

    // A UNIQUE/PRIMARY KEY constraint makes replay rejection atomic across concurrent requests.
    const inserted = await c.env.DB.prepare(
      'INSERT OR IGNORE INTO hmac_request_nonces (nonce, timestamp) VALUES (?, ?)',
    ).bind(nonce, timestamp).run();
    if (inserted.meta.changes === 0) {
      return c.json({ success: false, error: 'Request nonce already used' }, 401);
    }
    await next();
  } catch (error) {
    console.error('HMAC authentication failed', error instanceof Error ? error.message : 'unknown error');
    return c.json({ success: false, error: 'Authentication service unavailable' }, 503);
  }
};

app.get('/api/v1/sports/public/sessions', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT session_id, sport_type, home_team, away_team, created_at
       FROM sports_sessions ORDER BY created_at DESC LIMIT 20`,
    ).all();
    return c.json({ success: true, tier: 'Tier 3 - Public', data: results });
  } catch (error) {
    console.error('Failed to fetch public sports sessions', error instanceof Error ? error.message : 'unknown error');
    return c.json({ success: false, error: 'Failed to fetch public sessions' }, 500);
  }
});

app.get('/api/v1/sports/predictions/:sessionId', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const { results } = await c.env.DB.prepare(
      `SELECT model_id, session_id, model_version, win_probability_home, win_probability_away,
              confidence_score, updated_at
       FROM predictive_models WHERE session_id = ? ORDER BY updated_at DESC LIMIT 5`,
    ).bind(sessionId).all();
    return c.json({ success: true, tier: 'Tier 3 - Public', data: results });
  } catch (error) {
    console.error('Failed to fetch public predictions', error instanceof Error ? error.message : 'unknown error');
    return c.json({ success: false, error: 'Failed to fetch predictions' }, 500);
  }
});

app.use('/api/v1/internal/*', hmacAuthMiddleware);
app.use('/api/v1/sports/telemetry', hmacAuthMiddleware);

app.post('/api/v1/internal/icv/sync', async (c) => {
  let body: { node_id?: unknown; curvature_matrix?: unknown; alignment_score?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Request body must be valid JSON' }, 400);
  }
  if (
    typeof body.node_id !== 'string' || !body.node_id.trim() || body.node_id.length > 200 ||
    typeof body.alignment_score !== 'number' || !Number.isFinite(body.alignment_score) ||
    body.alignment_score < 0 || body.alignment_score > 1 || body.curvature_matrix === undefined
  ) {
    return c.json({ success: false, error: 'Invalid ICV state' }, 400);
  }

  try {
    const matrix = JSON.stringify(body.curvature_matrix);
    const updatedAt = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO identity_curvature_states (icv_id, node_id, curvature_matrix, alignment_score, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(icv_id) DO UPDATE SET
         curvature_matrix = excluded.curvature_matrix,
         alignment_score = excluded.alignment_score,
         updated_at = excluded.updated_at`,
    ).bind(`icv_node_${body.node_id}`, body.node_id, matrix, body.alignment_score, updatedAt).run();
    return c.json({ success: true, message: 'ICV state synchronized successfully' });
  } catch (error) {
    console.error('ICV sync failed', error instanceof Error ? error.message : 'unknown error');
    return c.json({ success: false, error: 'Internal server error during synchronization' }, 500);
  }
});

app.post('/api/v1/sports/telemetry', async (c) => {
  let body: {
    metric_id?: unknown; session_id?: unknown; player_id?: unknown;
    speed_mps?: unknown; acceleration_mps2?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Request body must be valid JSON' }, 400);
  }
  const isText = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
  if (
    !isText(body.metric_id) || !isText(body.session_id) || !isText(body.player_id) ||
    typeof body.speed_mps !== 'number' || !Number.isFinite(body.speed_mps) || body.speed_mps < 0 ||
    typeof body.acceleration_mps2 !== 'number' || !Number.isFinite(body.acceleration_mps2)
  ) return c.json({ success: false, error: 'Missing or invalid telemetry fields' }, 400);

  try {
    await c.env.DB.prepare(
      `INSERT INTO kinematic_metrics
       (metric_id, session_id, player_id, speed_mps, acceleration_mps2, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      body.metric_id.trim(), body.session_id.trim(), body.player_id.trim(),
      body.speed_mps, body.acceleration_mps2, Date.now(),
    ).run();
    return c.json({ success: true, message: 'Kinematic telemetry ingested successfully', metric_id: body.metric_id.trim() }, 201);
  } catch (error) {
    console.error('Telemetry insert failed', error instanceof Error ? error.message : 'unknown error');
    return c.json({ success: false, error: 'Unable to ingest telemetry' }, 500);
  }
});

export default app;
