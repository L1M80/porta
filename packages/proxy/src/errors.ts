/**
 * RPC error handling for Hono route handlers.
 */

import { RPCError } from "./rpc.js";

export function handleRPCError(c: { json: Function }, err: unknown) {
  if (err instanceof RPCError) {
    const status =
      err.code === "unauthenticated"
        ? 401
        : err.code === "unavailable"
          ? 503
          : 502;
    const clientMessage =
      err.code === "unauthenticated"
        ? "Authentication failed"
        : err.code === "unavailable"
          ? "Language Server unavailable"
          : "Upstream request failed";

    console.error("[Porta Proxy RPC Error]", err);
    return c.json({ error: clientMessage, code: err.code }, status);
  }

  console.error("[Porta Proxy Error]", err);
  return c.json({ error: "Internal Server Error" }, 500);
}
