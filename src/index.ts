import { Hono } from 'hono';
import { BeemaxCognitiveDO } from './durable-objects/BeemaxCognitiveDO';

export { BeemaxCognitiveDO };

interface Bindings {
  DB: D1Database;
  ENVIRONMENT: string;
  BEEMAX_COGNITIVE_DO: DurableObjectNamespace;
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

interface BeemaxChatInput {
  prompt: string;
  identity: string;
}

const app = new Hono<{ Bindings: Bindings }>();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

app.get('/', (c) => c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BEEMAX Cognitive Terminal</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #09090b; color: #e2e8f0; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.25rem; }
    main { width: min(760px, 100%); background: #121215; border: 1px solid #27272a; border-radius: 10px; padding: 1.25rem; }
    h1 { color: #38bdf8; font-size: 1rem; }
    #beemax-log { height: min(55vh, 420px); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: #000; border: 1px solid #27272a; border-radius: 6px; padding: 1rem; color: #34d399; }
    form { display: flex; gap: .5rem; margin-top: .75rem; }
    input, button { font: inherit; border-radius: 4px; padding: .65rem .8rem; }
    input { flex: 1; min-width: 0; color: inherit; background: #000; border: 1px solid #3f3f46; }
    button { border: 0; background: #38bdf8; color: #09090b; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .6; cursor: wait; }
    .note { color: #94a3b8; font-size: .75rem; }
  </style>
</head>
<body>
  <main>
    <h1>BEEMAX Interactive Cognitive Terminal</h1>
    <div id="beemax-log" aria-live="polite">[BEEMAX]: Cognitive terminal online. Type a command below.</div>
    <form id="beemax-form">
      <input type="text" id="beemax-input" maxlength="2000" placeholder="Ask BEEMAX anything…" autocomplete="off" required>
      <button id="beemax-submit" type="submit">Transmit</button>
    </form>
    <p class="note">Demo response engine. Identity is a display label and is not authenticated.</p>
  </main>
  <script>
    const form = document.getElementById('beemax-form');
    const input = document.getElementById('beemax-input');
    const log = document.getElementById('beemax-log');
    const submit = document.getElementById('beemax-submit');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const prompt = input.value.trim();
      if (!prompt) return;
      log.textContent += '\\n[YOU]: ' + prompt;
      input.value = '';
      submit.disabled = true;
      try {
        const response = await fetch('/api/beemax/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, identity: 'maxjurreau-3' })
        });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || 'Request failed');
        log.textContent += '\\n' + data.reply;
      } catch (error) {
        log.textContent += '\\n[ERROR]: ' + (error instanceof Error ? error.message : 'Transmission failed.');
      } finally {
        submit.disabled = false;
        log.scrollTop = log.scrollHeight;
        input.focus();
      }
    });
  </script>
</body>
</html>`));

app.get('/health', (c) => {
  return c.json({ status: 'healthy', gateway: 'max-sports', timestamp: Date.now() });
});

app.post('/api/beemax/chat', async (c) => {
  let body: BeemaxChatInput;
  try {
    body = await c.req.json<BeemaxChatInput>();
  } catch {
    return c.json({ success: false, error: 'Request body must be valid JSON' }, 400);
  }

  if (!body || !isNonEmptyString(body.prompt) || !isNonEmptyString(body.identity)) {
    return c.json({ success: false, error: 'Prompt and identity are required' }, 400);
  }

  const doId = c.env.BEEMAX_COGNITIVE_DO.idFromName('main-beemax-instance');
  const stub = c.env.BEEMAX_COGNITIVE_DO.get(doId);
  return stub.fetch(new Request('https://beemax.internal/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
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
       VALUES (?, ?, ?, ?, 'scheduled', ?)`,
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
       VALUES (?, ?, ?, ?, ?, ?)`,
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
       LIMIT 5`,
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
