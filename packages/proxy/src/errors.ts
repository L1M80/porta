/**
 * RPC error handling for Hono route handlers.
 */

import { RPCError } from "./rpc.js";

export function handleRPCError(c: { json: Function }, err: unknown) {
  if (err instanceof RPCError) {
    console.error("[Porta RPC Error]", err);
    const status =
      err.code === "unauthenticated"
        ? 401
        : err.code === "unavailable"
          ? 503
          : 502;
    return c.json({ error: "Internal Server Error", code: err.code }, status);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[Porta Proxy Error]", err);
  return c.json({ error: "Internal Server Error" }, 500);
}
