const WORKER_URL = process.env.WORKER_URL || 'https://max-sports-gateway.maxjurreau.workers.dev';
const OPERATOR_SECRET = process.env.AUTH_OPERATOR_SECRET;
const ARCHITECT_SECRET = process.env.AUTH_ARCHITECT_SECRET;

if (!OPERATOR_SECRET || !ARCHITECT_SECRET) {
  console.error('Set AUTH_OPERATOR_SECRET and AUTH_ARCHITECT_SECRET in the environment before running this test.');
  process.exit(1);
}
if (OPERATOR_SECRET === ARCHITECT_SECRET) {
  console.error('Operator and architect secrets must be different.');
  process.exit(1);
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) process.exitCode = 1;
}

function sessionCookie(response) {
  const value = response.headers.get('set-cookie');
  return value?.match(/(?:^|;\\s*)max_session=([^;]+)/)?.[1] ?? null;
}

async function login(identity, password) {
  return fetch(`${WORKER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
}

console.log(`MAX-QUANTM SPORTS tier authentication tests: ${WORKER_URL}`);

const guest = await fetch(`${WORKER_URL}/`, { headers: { Accept: 'text/html' } });
const guestHtml = await guest.text();
report('Unauthenticated request receives public login page', guest.ok && guestHtml.includes('TIER 3 // PUBLIC ACCESS GATEWAY'));

const spoofedArchitect = await login('maxjurreau-3', OPERATOR_SECRET);
report('Operator secret cannot claim architect identity', spoofedArchitect.status === 401);

const operatorLogin = await login('operator_trader_01', OPERATOR_SECRET);
const operatorCookie = sessionCookie(operatorLogin);
report('Operator login issues HttpOnly signed session cookie', operatorLogin.ok && !!operatorCookie && /HttpOnly/i.test(operatorLogin.headers.get('set-cookie') || ''));
if (operatorCookie) {
  const operatorHud = await fetch(`${WORKER_URL}/`, { headers: { Cookie: `max_session=${operatorCookie}` } });
  const html = await operatorHud.text();
  report('Operator session receives Tier 2 HUD', operatorHud.ok && html.includes('TIER 2 // OPERATOR'));
  const chat = await fetch(`${WORKER_URL}/api/beemax/chat`, {
    method: 'POST', headers: { Cookie: `max_session=${operatorCookie}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'health', identity: 'maxjurreau-3' }),
  });
  report('BEEMAX chat requires session and ignores client identity override', chat.status === 200);
  const logout = await fetch(`${WORKER_URL}/api/auth/logout`, { method: 'POST', headers: { Cookie: `max_session=${operatorCookie}` } });
  report('Logout expires the session cookie', logout.ok && /Max-Age=0/i.test(logout.headers.get('set-cookie') || ''));
}

const architectLogin = await login('maxjurreau-3', ARCHITECT_SECRET);
const architectCookie = sessionCookie(architectLogin);
report('Architect login issues session cookie', architectLogin.ok && !!architectCookie);
if (architectCookie) {
  const architectHud = await fetch(`${WORKER_URL}/`, { headers: { Cookie: `max_session=${architectCookie}` } });
  const html = await architectHud.text();
  report('Architect session receives Tier 1 HUD and BEEMAX terminal', architectHud.ok && html.includes('TIER 1 // SOVEREIGN ARCHITECT') && html.includes('BEEMAX Neural Terminal'));
}

const unauthenticatedChat = await fetch(`${WORKER_URL}/api/beemax/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'hello' }),
});
report('Unauthenticated BEEMAX chat is rejected', unauthenticatedChat.status === 401);
