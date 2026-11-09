import { Hono } from 'hono';

interface Bindings {
  DB: D1Database;
  ENVIRONMENT: string;
}

interface SportsSessionInput {
  session_id: string;
  sport_type: string;
  home_team: string;
  away_team: string;
}

interface TelemetryInput {
  metric_id: string;
  session_id: string;
  player_id: string;
  speed_mps: number;
  acceleration_mps2: number;
}

const app = new Hono<{ Bindings: Bindings }>();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

app.get('/health', (c) => {
  return c.json({ status: 'healthy', gateway: 'max-sports', timestamp: Date.now() });
});

app.post('/api/v1/sports/sessions', async (c) => {
  let body: SportsSessionInput;
  try {
    body = await c.req.json<SportsSessionInput>();
  } catch {
    return c.json({ success: false, error: 'Request body must be valid JSON' }, 400);
  }

  const { session_id, sport_type, home_team, away_team } = body;
  if (![session_id, sport_type, home_team, away_team].every(isNonEmptyString)) {
    return c.json({ success: false, error: 'Missing required session parameters' }, 400);
  }

  try {
    const createdAt = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO sports_sessions (session_id, sport_type, home_team, away_team, match_status, created_at)
       VALUES (?, ?, ?, ?, 'scheduled', ?)`
    )
      .bind(session_id.trim(), sport_type.trim(), home_team.trim(), away_team.trim(), createdAt)
      .run();

    return c.json({ success: true, message: 'Sports session registered', session_id: session_id.trim() }, 201);
  } catch (error) {
    console.error('Failed to register sports session', errorMessage(error));
    return c.json({ success: false, error: 'Unable to register sports session' }, 500);
  }
});

app.post('/api/v1/sports/telemetry', async (c) => {
  let body: TelemetryInput;
  try {
    body = await c.req.json<TelemetryInput>();
  } catch {
    return c.json({ success: false, error: 'Request body must be valid JSON' }, 400);
  }

  const { metric_id, session_id, player_id, speed_mps, acceleration_mps2 } = body;
  if (
    ![metric_id, session_id, player_id].every(isNonEmptyString) ||
    typeof speed_mps !== 'number' || !Number.isFinite(speed_mps) || speed_mps < 0 ||
    typeof acceleration_mps2 !== 'number' || !Number.isFinite(acceleration_mps2)
  ) {
    return c.json({ success: false, error: 'Missing or invalid kinematic payload fields' }, 400);
  }

  try {
    const timestamp = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO kinematic_metrics (metric_id, session_id, player_id, speed_mps, acceleration_mps2, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(metric_id.trim(), session_id.trim(), player_id.trim(), speed_mps, acceleration_mps2, timestamp)
      .run();

    return c.json({ success: true, message: 'Kinematic telemetry recorded', metric_id: metric_id.trim() }, 201);
  } catch (error) {
    console.error('Failed to record kinematic telemetry', errorMessage(error));
    return c.json({ success: false, error: 'Unable to record kinematic telemetry' }, 500);
  }
});

app.get('/api/v1/sports/predictions/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT model_id, session_id, model_version, win_probability_home, win_probability_away,
              confidence_score, updated_at
       FROM predictive_models
       WHERE session_id = ?
       ORDER BY updated_at DESC
       LIMIT 5`
    )
      .bind(sessionId)
      .all();

    return c.json({ success: true, session_id: sessionId, predictions: results });
  } catch (error) {
    console.error('Failed to load sports predictions', errorMessage(error));
    return c.json({ success: false, error: 'Unable to load sports predictions' }, 500);
  }
});

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

export default app;
