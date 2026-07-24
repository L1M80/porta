/**
 * Porta Proxy Server
 *
 * Hono HTTP server that provides a stable REST API over the
 * Antigravity Language Server's dynamic Connect RPC endpoint.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAdaptorServer } from "@hono/node-server";

import { discovery, rpc, conversationAffinity } from "./routing.js";
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

// ── Health & Diagnostics ──

app.get("/api/health", async (c) => {
  const instances = await discovery.getInstances();
  const lsDiagnostics = await Promise.all(
    instances.map(async (i) => {
      const start = Date.now();
      let reachable = false;
      let latencyMs = -1;
      try {
        await rpc.call("GetProcessInfo", {}, i);
        reachable = true;
        latencyMs = Date.now() - start;
      } catch {
        // Ping failed or timed out
      }
      return {
        pid: i.pid,
        httpsPort: i.httpsPort,
        workspaceId: i.workspaceId,
        source: i.source,
        reachable,
        latencyMs,
      };
    }),
  );

  const isOk = lsDiagnostics.length > 0 && lsDiagnostics.some((l) => l.reachable);
  return c.json({
    status: isOk ? "ok" : "degraded",
    proxy: {
      port: PORT,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    languageServers: lsDiagnostics,
    affinityEntries: conversationAffinity.size,
    rpcDiagnostics: rpc.getDiagnostics(),
  });
});

app.get("/api/diagnostics", async (c) => {
  const instances = await discovery.getInstances();
  const lsDiagnostics = await Promise.all(
    instances.map(async (i) => {
      const start = Date.now();
      let reachable = false;
      let latencyMs = -1;
      let errMessage = "";
      try {
        await rpc.call("GetProcessInfo", {}, i);
        reachable = true;
        latencyMs = Date.now() - start;
      } catch (err) {
        errMessage = err instanceof Error ? err.message : String(err);
      }
      return {
        pid: i.pid,
        httpsPort: i.httpsPort,
        workspaceId: i.workspaceId,
        source: i.source,
        reachable,
        latencyMs,
        error: errMessage || undefined,
      };
    }),
  );

  return c.json({
    timestamp: new Date().toISOString(),
    proxy: {
      port: PORT,
      host: HOST,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    },
    languageServers: lsDiagnostics,
    affinityCacheSize: conversationAffinity.size,
    rpcStats: rpc.getDiagnostics(),
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
