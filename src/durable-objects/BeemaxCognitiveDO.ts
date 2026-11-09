import { DurableObject } from "cloudflare:workers";

interface ChatMessage {
  role: "user" | "beemax";
  content: string;
  timestamp: number;
}

interface ChatRequest {
  prompt: string;
  identity: string;
}

const MAX_PROMPT_LENGTH = 2_000;
const MAX_IDENTITY_LENGTH = 100;
const MAX_HISTORY_MESSAGES = 100;

export class BeemaxCognitiveDO extends DurableObject {
  private history: ChatMessage[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.history = (await this.ctx.storage.get<ChatMessage[]>("history")) ?? [];
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/chat") {
      let body: ChatRequest;
      try {
        body = await request.json<ChatRequest>();
      } catch {
        return Response.json({ success: false, error: "Request body must be valid JSON" }, { status: 400 });
      }

      if (
        !body || typeof body.prompt !== "string" || !body.prompt.trim() ||
        body.prompt.length > MAX_PROMPT_LENGTH ||
        typeof body.identity !== "string" || !body.identity.trim() ||
        body.identity.length > MAX_IDENTITY_LENGTH
      ) {
        return Response.json({
          success: false,
          error: `Provide a non-empty prompt (up to ${MAX_PROMPT_LENGTH} characters) and identity (up to ${MAX_IDENTITY_LENGTH} characters).`,
        }, { status: 400 });
      }

      const prompt = body.prompt.trim();
      const identity = body.identity.trim();
      const responseText = this.synthesizeBeemaxResponse(prompt, identity);
      const now = Date.now();

      const write = this.writeQueue.then(async () => {
        this.history.push(
          { role: "user", content: prompt, timestamp: now },
          { role: "beemax", content: responseText, timestamp: Date.now() },
        );
        this.history = this.history.slice(-MAX_HISTORY_MESSAGES);
        await this.ctx.storage.put("history", this.history);
      });
      this.writeQueue = write.catch(() => undefined);

      try {
        await write;
      } catch {
        return Response.json({ success: false, error: "Unable to persist chat history" }, { status: 500 });
      }

      return Response.json({
        success: true,
        speaker: "BEEMAX-CORE",
        identityContext: identity,
        reply: responseText,
        icvState: { curvature: 0.88, coherence: "STABLE" },
      });
    }

    if (request.method === "GET" && url.pathname === "/history") {
      await this.writeQueue;
      return Response.json({ history: this.history.slice(-50) });
    }

    return new Response("Not found in BeemaxCognitiveDO", { status: 404 });
  }

  private synthesizeBeemaxResponse(prompt: string, identity: string): string {
    const lower = prompt.toLowerCase();
    if (lower.includes("status") || lower.includes("health")) {
      return `[BEEMAX // ICV MESH]: All systems nominal for node ${identity}.`;
    }
    if (lower.includes("wager") || lower.includes("sports")) {
      return "[BEEMAX // KINEMATIC ENGINE]: Sports and wager-related prompt received. No live predictions or escrow actions are performed by this demo response.";
    }
    return `[BEEMAX // COGNITIVE CORE]: Acknowledged, ${identity}. You said: “${prompt}”`;
  }
}
