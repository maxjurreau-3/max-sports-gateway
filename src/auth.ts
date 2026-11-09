import { verifyEd25519Signature } from "./lib/crypto";

export enum UserRole {
  PUBLIC = "PUBLIC",
  ANALYST = "ANALYST",
  GOVERNOR = "GOVERNOR",
}

export interface Env {
  GOVERNOR_API_TOKEN: string;
  STUDIO_DB: D1Database;
  SPORTS_TELEMETRY_DO: DurableObjectNamespace;
  WAGER_ESCROW_DO: DurableObjectNamespace;
  MODEL_SERVICE?: Fetcher;
}

interface AnalystNonceResult {
  nonce: string;
}

export async function authenticateRequest(
  request: Request,
  env: Env,
): Promise<{ role: UserRole; identity: string } | Response> {
  const authHeader = request.headers.get("Authorization");

  // Governor requests use a bearer token. A supplied but invalid bearer token
  // is rejected rather than silently treated as a public or analyst request.
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    if (env.GOVERNOR_API_TOKEN && token === env.GOVERNOR_API_TOKEN) {
      return { role: UserRole.GOVERNOR, identity: "system-governor-root" };
    }
    return new Response("Forbidden: Invalid Governor Token", { status: 403 });
  }

  // Analyst requests use a signed timestamp/nonce challenge.
  const pubKey = request.headers.get("X-Analyst-Pubkey");
  const signature = request.headers.get("X-Analyst-Sig");
  const nonce = request.headers.get("X-Analyst-Nonce");
  const timestampHeader = request.headers.get("X-Analyst-Timestamp");
  const analystHeaders = [pubKey, signature, nonce, timestampHeader];
  const hasAnyAnalystHeader = analystHeaders.some((value) => value !== null);

  if (hasAnyAnalystHeader) {
    if (analystHeaders.some((value) => !value)) {
      return new Response("Unauthorized: Incomplete analyst credentials", { status: 401 });
    }

    const timestamp = Number(timestampHeader);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 300_000) {
      return new Response("Unauthorized: Timestamp out of bounds", { status: 401 });
    }

    // Verify before consuming the nonce, so invalid signatures cannot burn a
    // legitimate analyst's nonce. The database must enforce uniqueness on
    // (identity, nonce) to make the insert atomic under concurrent requests.
    const message = `${request.url}:${timestampHeader}:${nonce}`;
    const isValid = await verifyEd25519Signature(pubKey!, signature!, message);
    if (!isValid) {
      return new Response("Unauthorized: Invalid Ed25519 Signature", { status: 401 });
    }

    const existingNonce = await env.STUDIO_DB.prepare(
      "SELECT nonce FROM studio_nonces WHERE identity = ? AND nonce = ?",
    )
      .bind(pubKey, nonce)
      .first<AnalystNonceResult>();

    if (existingNonce) {
      return new Response("Unauthorized: Nonce replay detected", { status: 401 });
    }

    try {
      const inserted = await env.STUDIO_DB.prepare(
        "INSERT OR IGNORE INTO studio_nonces (identity, nonce, timestamp) VALUES (?, ?, ?)",
      )
        .bind(pubKey, nonce, timestamp)
        .run();

      if (inserted.meta.changes === 0) {
        return new Response("Unauthorized: Nonce replay detected", { status: 401 });
      }
    } catch {
      return new Response("Unauthorized: Nonce could not be recorded", { status: 503 });
    }

    return { role: UserRole.ANALYST, identity: pubKey! };
  }

  return {
    role: UserRole.PUBLIC,
    identity: request.headers.get("CF-Connecting-IP") || "anonymous",
  };
}
