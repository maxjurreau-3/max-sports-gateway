import { DurableObject } from "cloudflare:workers";

export class SportsTelemetryDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({
        type: "HANDSHAKE",
        status: "CONNECTED",
        timestamp: Date.now(),
      }));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === "POST" && url.pathname === "/broadcast") {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }

      const message = JSON.stringify(payload);
      const sockets = this.ctx.getWebSockets();
      let activeConnections = 0;
      for (const socket of sockets) {
        try {
          socket.send(message);
          activeConnections += 1;
        } catch {
          try {
            socket.close(1011, "Broadcast failed");
          } catch {
            // Socket is already closed.
          }
        }
      }

      return Response.json({ success: true, activeConnections, timestamp: Date.now() });
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return Response.json({
        durableObject: "SportsTelemetryDO",
        activeConnections: this.ctx.getWebSockets().length,
      });
    }

    return new Response("Not found in SportsTelemetryDO", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const text = typeof message === "string" ? message : new TextDecoder().decode(message);
      const data: unknown = JSON.parse(text);
      if (typeof data === "object" && data !== null && "type" in data && data.type === "PING") {
        ws.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
      }
    } catch {
      // Ignore malformed client messages.
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Cloudflare removes closed sockets from the accepted WebSocket list.
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    try {
      ws.close(1011, "WebSocket error");
    } catch {
      // Socket is already closed.
    }
  }
}
