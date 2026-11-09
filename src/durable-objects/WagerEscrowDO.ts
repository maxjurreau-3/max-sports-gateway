import { DurableObject } from "cloudflare:workers";

export interface WagerEscrowState {
  wagerId: string;
  matchId: string;
  makerIdentity: string;
  takerIdentity?: string;
  stakeAmount: number;
  oddsRatio: number;
  marketCondition: {
    targetMetric: string;
    lineValue: number;
    side: string;
  };
  status: "OPEN" | "MATCHED" | "SETTLED" | "DISPUTED";
  winner?: string;
  lockedAt?: number;
  settledAt?: number;
}

interface LockWagerRequest {
  wagerId: string;
  matchId: string;
  makerIdentity: string;
  stakeAmount: number;
  oddsRatio: number;
  marketCondition: WagerEscrowState["marketCondition"];
  takerIdentity: string;
  takerSignature: string;
}

export class WagerEscrowDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let state = await this.ctx.storage.get<WagerEscrowState>("wagerState");

    if (url.pathname === "/lock" && request.method === "POST") {
      let body: LockWagerRequest;
      try {
        body = await request.json<LockWagerRequest>();
      } catch {
        return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }

      if (
        !body ||
        typeof body.wagerId !== "string" || !body.wagerId.trim() ||
        typeof body.matchId !== "string" || !body.matchId.trim() ||
        typeof body.makerIdentity !== "string" || !body.makerIdentity.trim() ||
        typeof body.takerIdentity !== "string" || !body.takerIdentity.trim() ||
        typeof body.takerSignature !== "string" || !body.takerSignature.trim() ||
        typeof body.stakeAmount !== "number" || !Number.isFinite(body.stakeAmount) || body.stakeAmount <= 0 ||
        typeof body.oddsRatio !== "number" || !Number.isFinite(body.oddsRatio) || body.oddsRatio <= 0 ||
        !body.marketCondition || typeof body.marketCondition.targetMetric !== "string" ||
        typeof body.marketCondition.lineValue !== "number" || !Number.isFinite(body.marketCondition.lineValue) ||
        typeof body.marketCondition.side !== "string"
      ) {
        return Response.json({ error: "Missing or invalid wager details" }, { status: 400 });
      }

      if (state && state.status !== "OPEN") {
        return Response.json({ error: "Wager is already matched, settled, or closed." }, { status: 409 });
      }

      // The first lock request initializes state. The Worker must supply the
      // complete original offer and must authenticate the taker's signature.
      if (!state) {
        state = {
          wagerId: body.wagerId,
          matchId: body.matchId,
          makerIdentity: body.makerIdentity,
          stakeAmount: body.stakeAmount,
          oddsRatio: body.oddsRatio,
          marketCondition: body.marketCondition,
          status: "OPEN",
        };
      }

      if (state.wagerId !== body.wagerId || state.makerIdentity !== body.makerIdentity) {
        return Response.json({ error: "Wager offer does not match escrow state." }, { status: 409 });
      }

      state.takerIdentity = body.takerIdentity;
      state.status = "MATCHED";
      state.lockedAt = Date.now();
      await this.ctx.storage.put("wagerState", state);

      return Response.json({
        success: true,
        status: "MATCHED",
        wagerId: state.wagerId,
        lockedAt: state.lockedAt,
      });
    }

    if (url.pathname === "/settle" && request.method === "POST") {
      if (!state || state.status !== "MATCHED") {
        return Response.json({ error: "Wager is not in a MATCHED state ready for settlement." }, { status: 409 });
      }

      let outcome: { actualResultValue: number; winningSide: "HOME" | "AWAY" | "OVER" | "UNDER" };
      try {
        outcome = await request.json();
      } catch {
        return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }

      if (
        !outcome || typeof outcome.actualResultValue !== "number" || !Number.isFinite(outcome.actualResultValue) ||
        !["HOME", "AWAY", "OVER", "UNDER"].includes(outcome.winningSide)
      ) {
        return Response.json({ error: "Invalid settlement outcome" }, { status: 400 });
      }

      const makerWins = outcome.winningSide === state.marketCondition.side;
      state.winner = makerWins ? state.makerIdentity : state.takerIdentity;
      state.status = "SETTLED";
      state.settledAt = Date.now();
      await this.ctx.storage.put("wagerState", state);

      return Response.json({
        success: true,
        status: "SETTLED",
        winner: state.winner,
        settledAt: state.settledAt,
        outcome,
      });
    }

    if (url.pathname === "/state" && request.method === "GET") {
      return Response.json({ wagerState: state ?? { status: "UNINITIALIZED" } });
    }

    return new Response("Not found in WagerEscrowDO", { status: 404 });
  }
}
