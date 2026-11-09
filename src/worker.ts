import app from "./index";

// Wrangler resolves Durable Object classes from the configured Worker entrypoint.
export { SportsTelemetryDO } from "./durable-objects/SportsTelemetryDO";
export { WagerEscrowDO } from "./durable-objects/WagerEscrowDO";
export { BeemaxCognitiveDO } from "./durable-objects/BeemaxCognitiveDO";

export default app;
