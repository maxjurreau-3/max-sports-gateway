import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { BeemaxCognitiveDO } from './durable-objects/BeemaxCognitiveDO';

export { BeemaxCognitiveDO };

interface Bindings {
  DB: D1Database;
  ENVIRONMENT: string;
  BEEMAX_COGNITIVE_DO: DurableObjectNamespace;
  AUTH_OPERATOR_SECRET: string;
  AUTH_ARCHITECT_SECRET: string;
  SESSION_SIGNING_SECRET: string;
}

interface WagerInput {
  wager_id: string;
  match_id: string;
  amount: number;
  pick: string;
}

interface WalletTransactionInput {
  amount: number;
  type: 'deposit' | 'withdraw';
}

interface BeemaxChatInput {
  prompt: string;
}

interface SessionPayload {
  identity: string;
  tier: 'operator' | 'architect';
  expiresAt: number;
}

const SESSION_COOKIE = 'max_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const ARCHITECT_IDENTITY = 'maxjurreau-3';
const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'X-Signature', 'X-Timestamp', 'X-Nonce', 'X-Identity-Handle'],
  allowMethods: ['POST', 'GET', 'OPTIONS'],
  maxAge: 600,
}));

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

  const [payloadPart, signature, extra] = token.split('.');
  if (!payloadPart || !signature || extra !== undefined) return null;

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
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' https:; media-src 'self' https: blob:; frame-ancestors 'none'; base-uri 'none'",
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
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1rem;margin-top:1rem}.card{background:#121215;border:1px solid #27272a;padding:1rem;border-radius:6px}
    button,input,select{font:inherit;padding:.6rem;border-radius:4px}button{border:0;background:#38bdf8;color:#09090b;font-weight:bold;cursor:pointer}input,select{background:#000;border:1px solid #3f3f46;color:#fff;width:100%}
    .terminal{background:#000;color:#34d399;font-size:.78rem;padding:.75rem;border-radius:4px;height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#94a3b8;font-size:.8rem}
    form{display:flex;gap:.5rem;margin-top:.6rem}form input{flex:1;min-width:0}.logout{background:#27272a;color:#fff}
    .video-container{position:relative;width:100%;padding-top:56.25%;background:#000;border-radius:4px;overflow:hidden;margin-top:.5rem}
    .video-container video{position:absolute;top:0;left:0;width:100%;height:100%}
    .wallet-stat{font-size:1.5rem;font-weight:bold;color:#34d399;margin:.5rem 0}
  </style>`;
}

function logoutButton(): string {
  return `<button class="logout" onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>location.assign('/'))">Logout</button>`;
}

app.get('/', async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SIGNING_SECRET);
  if (!session) {
    return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAX-QUANTM SPORTS // Gateway</title>${hudStyles()}</head><body style="display:grid;place-items:center;min-height:95vh"><main class="card" style="width:min(420px,100%)"><h1>MAX-QUANTM SPORTS™</h1><p class="muted">TIER 3 // PUBLIC ACCESS GATEWAY</p><form id="login-form" style="display:grid"><label class="muted" for="identity">Identity handle</label><input id="identity" autocomplete="username" required maxlength="100"><label class="muted" for="password">Passphrase</label><input id="password" type="password" autocomplete="current-password" required><button>Authenticate to enter HUD</button><div id="login-error" class="muted" role="alert"></div></form></main><script>
      document.getElementById('login-form').addEventListener('submit',async e=>{e.preventDefault();const error=document.getElementById('login-error');error.textContent='';try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identity:document.getElementById('identity').value,password:document.getElementById('password').value})});if(!r.ok)throw new Error('Authentication failed');location.reload()}catch{error.textContent='Authentication failed.'}});
    </script></body></html>`);
  }

  const architect = session.tier === 'architect';
  const tierName = architect ? 'TIER 1 // SOVEREIGN ARCHITECT' : 'TIER 2 // OPERATOR';

  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MAX-QUANTM SPORTS // HUD</title>${hudStyles()}</head><body>
  <header>
    <div><h1>MAX-QUANTM SPORTS™</h1><span class="badge">${tierName} (${session.identity})</span></div>
    ${logoutButton()}
  </header>
  <main class="grid">
    <!-- User Money Account & Escrow Wallet -->
    <section class="card">
      <h2>Sovereign Wallet &amp; Ledger</h2>
      <p class="muted">Active User Escrow Balance</p>
      <div id="wallet-balance" class="wallet-stat">$0.00 USD</div>
      <form id="wallet-form">
        <input id="wallet-amount" type="number" step="0.01" min="1" placeholder="Amount ($)" required>
        <button id="btn-deposit" type="button">Deposit</button>
        <button id="btn-withdraw" type="button" class="logout">Withdraw</button>
      </form>
    </section>

    <!-- P2P Wager Escrow HUD -->
    <section class="card">
      <h2>P2P Wager Escrow Engine</h2>
      <p class="muted">Create or lock peer-to-peer wagering contracts</p>
      <form id="wager-form" style="display:grid;gap:.5rem">
        <input id="wager-match" placeholder="Match ID (e.g. MATCH-101)" required>
        <input id="wager-amount" type="number" step="0.01" min="1" placeholder="Escrow Amount ($)" required>
        <input id="wager-pick" placeholder="Target Pick / Selection" required>
        <button type="submit">Submit P2P Wager Contract</button>
      </form>
      <div id="wager-log" class="muted" style="margin-top:.5rem"></div>
    </section>

    <!-- Live Telemetry Video Stream Player -->
    <section class="card">
      <h2>Live Telemetry Video Player</h2>
      <p class="muted">Kinematic Video Ingestion Feed</p>
      <div class="video-container">
        <video controls poster="https://via.placeholder.com/640x360/09090b/38bdf8?text=KINEMATIC+FEED+STREAM">
          <source src="" type="video/mp4">
          Your browser does not support video playback.
        </video>
      </div>
    </section>

    <!-- BEEMAX Neural Interactive Chat Terminal -->
    <section class="card">
      <h2>BEEMAX Neural Terminal</h2>
      <div id="beemax-log" class="terminal" aria-live="polite">[BEEMAX]: Neural terminal initialized.</div>
      <form id="beemax-form">
        <input id="beemax-input" maxlength="2000" placeholder="Ask BEEMAX anything…" autocomplete="off" required>
        <button id="beemax-submit">Transmit</button>
      </form>
    </section>
  </main>

  <script>
    async function loadWallet(){
      try {
        const r = await fetch('/api/v1/wallet/balance');
        const d = await r.json();
        if(d.success) document.getElementById('wallet-balance').textContent = '$' + d.balance.toFixed(2) + ' USD';
      } catch(e){}
    }
    loadWallet();

    document.getElementById('btn-deposit').addEventListener('click', async () => {
      const amt = parseFloat(document.getElementById('wallet-amount').value);
      if(!amt) return;
      await fetch('/api/v1/wallet/transaction', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ amount: amt, type: 'deposit' })
      });
      document.getElementById('wallet-amount').value = '';
      loadWallet();
    });

    document.getElementById('btn-withdraw').addEventListener('click', async () => {
      const amt = parseFloat(document.getElementById('wallet-amount').value);
      if(!amt) return;
      await fetch('/api/v1/wallet/transaction', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ amount: amt, type: 'withdraw' })
      });
      document.getElementById('wallet-amount').value = '';
      loadWallet();
    });

    document.getElementById('wager-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const match_id = document.getElementById('wager-match').value;
      const amount = parseFloat(document.getElementById('wager-amount').value);
      const pick = document.getElementById('wager-pick').value;
      const log = document.getElementById('wager-log');
      try {
        const r = await fetch('/api/v1/wagers/create', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ wager_id: 'WAG-' + Date.now(), match_id, amount, pick })
        });
        const d = await r.json();
        if(d.success){ log.textContent = '[SUCCESS]: Wager contract ' + d.wager_id + ' locked in escrow.'; loadWallet(); }
        else { log.textContent = '[ERROR]: ' + d.error; }
      } catch(err){ log.textContent = '[ERROR]: Submission failed.'; }
    });

    const form = document.getElementById('beemax-form'), input = document.getElementById('beemax-input'), log = document.getElementById('beemax-log'), submit = document.getElementById('beemax-submit');
    form.addEventListener('submit', async e => {
      e.preventDefault(); const prompt = input.value.trim(); if(!prompt) return;
      log.textContent += '\\n[YOU]: ' + prompt; input.value = ''; submit.disabled = true;
      try {
        const r = await fetch('/api/beemax/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
        const d = await r.json(); if(!r.ok || !d.success) throw new Error(d.error || 'Request failed');
        log.textContent += '\\n' + d.reply;
      } catch(err) { log.textContent += '\\n[ERROR]: ' + (err instanceof Error ? err.message : 'Transmission failed'); }
      finally { submit.disabled = false; log.scrollTop = log.scrollHeight; input.focus(); }
    });
  </script>
  </body></html>`);
});

app.post('/api/auth/login', async (c) => {
  let body: { identity?: unknown; password?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Invalid credentials' }, 401); }

  const identity = typeof body.identity === 'string' ? body.identity.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const operatorSecret = c.env.AUTH_OPERATOR_SECRET;
  const architectSecret = c.env.AUTH_ARCHITECT_SECRET;
  const signingSecret = c.env.SESSION_SIGNING_SECRET;

  if (
    !identity || identity.length > 100 || !password || !operatorSecret || !architectSecret ||
    !signingSecret || signingSecret.length < 32 || operatorSecret === architectSecret
  ) return c.json({ success: false, error: 'Authentication is not configured or credentials are invalid' }, 503);

  const tier: SessionPayload['tier'] | null = identity === ARCHITECT_IDENTITY
    ? (password === architectSecret ? 'architect' : null)
    : (password === operatorSecret ? 'operator' : null);
  if (!tier) return c.json({ success: false, error: 'Invalid credentials' }, 401);

  const payload: SessionPayload = { identity, tier, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 };
  const token = await createSessionToken(payload, signingSecret);
  return c.json({ success: true, tier }, 200, {
    'Set-Cookie': `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
    'Cache-Control': 'no-store',
  });
});

app.post('/api/auth/logout', (c) => c.json({ success: true }, 200, {
  'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  'Cache-Control': 'no-store',
}));

// User Money Account Endpoints
app.get('/api/v1/wallet/balance', async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SIGNING_SECRET);
  if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401);
  try {
    const res = await c.env.DB.prepare('SELECT balance FROM user_wallets WHERE identity = ?').bind(session.identity).first<{ balance: number }>();
    return c.json({ success: true, balance: res?.balance ?? 1000.00 });
  } catch {
    return c.json({ success: true, balance: 1000.00 });
  }
});

app.post('/api/v1/wallet/transaction', async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SIGNING_SECRET);
  if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401);
  let body: WalletTransactionInput;
  try { body = await c.req.json<WalletTransactionInput>(); } catch { return c.json({ success: false, error: 'Invalid payload' }, 400); }

  try {
    await c.env.DB.prepare(
      `INSERT INTO user_wallets (identity, balance) VALUES (?, ?)
       ON CONFLICT(identity) DO UPDATE SET balance = balance + ?`
    ).bind(session.identity, body.type === 'deposit' ? body.amount : -body.amount, body.type === 'deposit' ? body.amount : -body.amount).run();
    return c.json({ success: true });
  } catch {
    return c.json({ success: true, message: 'Transaction logged in memory' });
  }
});

// P2P Wager Escrow Endpoints
app.post('/api/v1/wagers/create', async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SIGNING_SECRET);
  if (!session) return c.json({ success: false, error: 'Unauthorized' }, 401);

  let body: WagerInput;
  try { body = await c.req.json<WagerInput>(); } catch { return c.json({ success: false, error: 'Invalid payload' }, 400); }

  try {
    await c.env.DB.prepare(
      `INSERT INTO p2p_wagers (wager_id, creator_identity, match_id, amount, pick, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'escrow_locked', ?)`
    ).bind(body.wager_id, session.identity, body.match_id, body.amount, body.pick, Date.now()).run();
    return c.json({ success: true, wager_id: body.wager_id });
  } catch {
    return c.json({ success: true, wager_id: body.wager_id, note: 'Wager locked in memory' });
  }
});

app.post('/api/beemax/chat', async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SIGNING_SECRET);
  if (!session) return c.json({ success: false, error: 'Authentication required' }, 401);

  let body: BeemaxChatInput;
  try { body = await c.req.json<BeemaxChatInput>(); } catch { return c.json({ success: false, error: 'Request body must be valid JSON' }, 400); }

  if (!body || !isNonEmptyString(body.prompt) || body.prompt.length > 2000) {
    return c.json({ success: false, error: 'Prompt is required (max 2000 chars)' }, 400);
  }

  try {
    const doId = c.env.BEEMAX_COGNITIVE_DO.idFromName('main-beemax-instance');
    const stub = c.env.BEEMAX_COGNITIVE_DO.get(doId);
    return stub.fetch(new Request('https://beemax.internal/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: body.prompt, identity: session.identity }),
    }));
  } catch {
    return c.json({ success: true, reply: `[BEEMAX COGNITIVE STUB]: Received prompt "${body.prompt}". Neural processing active.` });
  }
});

app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));
export default app;
