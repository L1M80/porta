/**
 * Porta Proxy Server
 *
 * Hono HTTP server that provides a stable REST API over the
 * Antigravity Language Server's dynamic Connect RPC endpoint.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAdaptorServer } from "@hono/node-server";

import { discovery } from "./routing.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerRpcPassthroughRoutes } from "./routes/rpcPassthrough.js";
import {
  assertSupportedListenHost,
  formatListenAddress,
  resolveProxyHost,
} from "./exposure.js";
import { getAllowedOrigins, resolveCorsOrigin } from "./origins.js";
import { setupWebSocket } from "./ws.js";

const PORT = parseInt(process.env.PORTA_PORT ?? "3170", 10);
const HOST = resolveProxyHost();

assertSupportedListenHost(HOST, process.env);

const app = new Hono();

// ── Middleware ──

const ALLOWED_ORIGINS = getAllowedOrigins();

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin, ALLOWED_ORIGINS),
  }),
);

// ── Health ──

app.get("/api/health", async (c) => {
  const instances = await discovery.getInstances();
  return c.json({
    status: "ok",
    proxy: { port: PORT, uptime: process.uptime() },
    languageServers: instances.map((i) => ({
      pid: i.pid,
      httpsPort: i.httpsPort,
      workspaceId: i.workspaceId,
      source: i.source,
    })),
  });
});

// ── Routes ──

registerConversationRoutes(app);
registerModelRoutes(app);
registerWorkspaceRoutes(app);
registerFileRoutes(app);
registerSearchRoutes(app);
registerRpcPassthroughRoutes(app);

// ── Start ──

const listenAddress = formatListenAddress(HOST, PORT);

console.log(`🚀 Porta proxy starting on ${listenAddress}`);

const server = createAdaptorServer({ fetch: app.fetch, port: PORT });

setupWebSocket(server, PORT, ALLOWED_ORIGINS);

void discovery
  .getInstances()
  .then((instances) => {
    if (instances.length > 0) return;

    console.warn(
      `⚠️ No Antigravity Language Server instances discovered. Make sure Antigravity is running.`,
    );
  })
  .catch((err) => {
    console.warn(`⚠️ Initial discovery failed: ${(err as Error).message}`);
  });

server.listen(PORT, HOST, () => {
  console.log(`✅ Porta proxy listening on ${listenAddress}`);
});
