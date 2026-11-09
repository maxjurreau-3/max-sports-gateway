import app from './index';
import sportsApi, { type SportsApiEnv } from './routes/sports-api';

// Wrangler resolves all Durable Object classes from the configured entrypoint.
export { SportsTelemetryDO } from './durable-objects/SportsTelemetryDO';
export { WagerEscrowDO } from './durable-objects/WagerEscrowDO';
export { BeemaxCognitiveDO } from './durable-objects/BeemaxCognitiveDO';

interface WorkerEnv extends SportsApiEnv {
  ENVIRONMENT: string;
  BEEMAX_COGNITIVE_DO: DurableObjectNamespace;
  AUTH_OPERATOR_SECRET: string;
  AUTH_ARCHITECT_SECRET: string;
  SESSION_SIGNING_SECRET: string;
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    const isSportsApi = pathname === '/api/v1/sports/public/sessions' ||
      pathname.startsWith('/api/v1/sports/predictions/') ||
      pathname === '/api/v1/sports/telemetry' ||
      pathname.startsWith('/api/v1/internal/');

    if (isSportsApi) return sportsApi.fetch(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};
