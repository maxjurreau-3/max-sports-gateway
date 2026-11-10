import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Bindings {
  DB: D1Database;
  ENVIRONMENT: string;
  AUTH_OPERATOR_SECRET: string;
  AUTH_ARCHITECT_SECRET: string;
  SESSION_SIGNING_SECRET: string;
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

interface SessionPayload {
  identity: string;
  tier: 'operator' | 'architect';
  expiresAt: number;
}

const SESSION_COOKIE = 'max_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
const ARCHITECT_IDENTITY = 'maxjurreau-3';
const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for client applications and HUD access
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'X-Signature', 'X-Timestamp', 'X-Nonce', 'X-Identity-Handle'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  maxAge: 600,
}));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signSession(payloadPart: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function createSessionToken(payload: SessionPayload, secret: string): Promise<string> {
  const payloadPart = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${payloadPart}.${await signSession(payloadPart, secret)}`;
}

async function readSession(request: Request, secret: string): Promise<SessionPayload | null> {
  const cookie = request.headers.get('Cookie')?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  const token = cookie?.slice(SESSION_COOKIE.length + 1);
  if (!token || !secret || secret.length < 32) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, signature] = parts;

  try {
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC', key, base64UrlToBytes(signature), new TextEncoder().encode(payloadPart),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadPart))) as Partial<SessionPayload>;
    if (
      typeof payload.identity !== 'string' || !payload.identity ||
      (payload.tier !== 'operator' && payload.tier !== 'architect') ||
      typeof payload.expiresAt !== 'number' || payload.expiresAt <= Date.now()
    ) return null;
    if (payload.tier === 'architect' && payload.identity !== ARCHITECT_IDENTITY) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function hudStyles(): string {
  return `<style>
    :root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#09090b;color:#e2e8f0}
    *{box-sizing:border-box}body{margin:0;padding:1.25rem}header{border-bottom:1px solid #27272a;padding-bottom:.75rem;display:flex;justify-content:space-between;align-items:center;gap:1rem}
    h1{color:#38bdf8;margin:0;font-size:1.1rem}.badge{display:inline-block;margin-top:.4rem;padding:.2rem .5rem;border:1px solid #3f3f46;border-radius:4px;font-size:.7rem;color:#34d399}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin-top:1rem}.card{background:#121215;border:1px solid #27272a;padding:1rem;border-radius:6px}
    button,input{font:inherit;padding:.6rem;border-radius:4px}button{border:0;background:#38bdf8;color:#09090b;font-weight:bold;cursor:pointer}input{background:#000;border:1px solid #3f3f46;color:#fff;width:100%}
    .terminal{background:#000;color:#34d399;font-size:.78rem;padding:.75rem;border-radius:4px;height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#94a3b8;font-size:.8rem}
    form{display:flex;gap:.5rem;margin-top:.6rem}form input{flex:1;min-width:0}.logout{background:#27272a;color:#fff}
  </style>`;
}

function logoutButton(): string {
  return `<button class="logout" onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.assign('/'))">Logout</button>`;
}

app.get('/', async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SIGNING_SECRET);
  if (!session) {
    return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAX-SPORTS GATEWAY</title>${hudStyles()}</head><body style="display:grid;place-items:center;min-height:95vh"><main class="card" style="width:min(420px,100%)"><h1>MAX-SPORTS GATEWAY™</h1><p class="muted">TIER 3 // PUBLIC ACCESS GATEWAY</p><form id="login-form" style="display:grid"><label class="muted" for="identity">Identity handle</label><input id="identity" autocomplete="username" required maxlength="100"><label class="muted" for="password">Passphrase</label><input id="password" type="password" autocomplete="current-password" required><button>Authenticate to enter HUD</button><div id="login-error" class="muted" role="alert"></div></form></main><script>
      document.getElementById('login-form').addEventListener('submit',async e=>{e.preventDefault();const error=document.getElementById('login-error');error.textContent='';try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity:document.getElementById('identity').value,password:document.getElementById('password').value})});if(!r.ok)throw new Error('Authentication failed');location.reload()}catch{error.textContent='Authentication failed.'}});
    </script></body></html>`);
  }

  const architect = session.tier === 'architect';
  const tierName = architect ? 'TIER 1 // SOVEREIGN ARCHITECT' : 'TIER 2 // OPERATOR';
  const middleCard = architect
    ? `<section class="card"><h2>Live Telemetry Feed</h2><div class="terminal">[ARCHITECT INSPECTOR ONLINE] Telemetry API is available at /api/v1/sports/.</div></section>`
    : `<section class="card"><h2>Kinematic Predictions &amp; Match Analytics</h2><div class="terminal">Match analytics ready for high-frequency ingestion.</div></section>`;

  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAX-SPORTS // ${tierName}</title>${hudStyles()}</head><body><header><div><h1>MAX-SPORTS GATEWAY™</h1><span class="badge">${tierName} (${session.identity})</span></div>${logoutButton()}</header><main class="grid"><section class="card"><h2>System Controls</h2><p class="muted">Authenticated session active. D1 database connected.</p></section>${middleCard}</main></body></html>`);
});

app.post('/api/auth/login', async (c) => {
  let body: { identity?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid credentials' }, 401);
  }

  const identity = typeof body.identity === 'string' ? body.identity.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const operatorSecret = c.env.AUTH_OPERATOR_SECRET;
  const architectSecret = c.env.AUTH_ARCHITECT_SECRET;
  const signingSecret = c.env.SESSION_SIGNING_SECRET;

  if (
    !identity || identity.length > 100 || !password || !operatorSecret || !architectSecret ||
    !signingSecret || signingSecret.length < 32 || operatorSecret === architectSecret
  ) return c.json({ success: false, error: 'Authentication configuration missing or invalid secrets' }, 503);

  const tier: SessionPayload['tier'] | null = identity === ARCHITECT_IDENTITY
    ? (password === architectSecret ? 'architect' : null)
    : (password === operatorSecret ? 'operator' : null);
  if (!tier) return c.json({ success: false, error: 'Invalid credentials' }, 401);

  const payload: SessionPayload = { identity, tier, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
  const token = await createSessionToken(payload, signingSecret);
  return c.json({ success: true, tier }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
    'Cache-Control': 'no-store',
  });
});

app.post('/api/auth/logout', (c) => c.json({ success: true }, 200, {
  'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  'Cache-Control': 'no-store',
}));

app.get('/health', (c) => c.json({ status: 'healthy', gateway: 'max-sports-gateway', timestamp: Date.now() }));

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
    ).bind(session_id.trim(), sport_type.trim(), home_team.trim(), away_team.trim(), createdAt).run();
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
  ) return c.json({ success: false, error: 'Missing or invalid kinematic payload fields' }, 400);

  try {
    const timestamp = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO kinematic_metrics (metric_id, session_id, player_id, speed_mps, acceleration_mps2, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(metric_id.trim(), session_id.trim(), player_id.trim(), speed_mps, acceleration_mps2, timestamp).run();
    return c.json({ success: true, message: 'Kinematic telemetry recorded', metric_id: metric_id.trim() }, 201);
  } catch (error) {
    console.error('Failed to record kinematic telemetry', errorMessage(error));
    return c.json({ success: false, error: 'Unable to record kinematic telemetry' }, 500);
  }
});

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
export default app;
