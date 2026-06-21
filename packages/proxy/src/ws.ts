/**
 * WebSocket delta polling for real-time step streaming.
 *
 * Two states:
 *   IDLE   — No active agent run. A low-frequency heartbeat checks for
 *            externally-started or externally-completed updates.
 *   ACTIVE — Agent is running. 200ms serial polling for near-streaming UX.
 *
 * Activation triggers (IDLE → ACTIVE):
 *   - conversationSignals "activate" (REST: SendMessage / StartCascade / Revert)
 *   - Idle heartbeat detecting RUNNING status or new externally-added steps
 *   - Initial connection detecting RUNNING status
 *
 * Deactivation (ACTIVE → IDLE):
 *   3 consecutive polls with no step-count growth + definitive terminal status.
 *
 * The `sync` message from the client only updates the offset cursor —
 * it does NOT change polling state.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { rpcForConversation, getStepCount } from "./routing.js";
import { messageTracker } from "./message-tracker.js";
import { getAllowedOrigins, isAllowedOrigin, type AllowedOrigin } from "./origins.js";
import {
  oversizedStepOffset,
  isRecoverableStepError,
  findNextValidOffset,
  placeholderStep,
} from "./step-recovery.js";
import { conversationSignals } from "./signals.js";

/** Active polling interval (ms). */
const ACTIVE_INTERVAL = 200;
/** Idle polling interval (ms) for externally-originated updates. */
const HEARTBEAT_INTERVAL = 5000;
/** Transport keepalive interval (ms) for detecting dead idle sockets. */
const SOCKET_KEEPALIVE_INTERVAL = 25_000;

/**
 * How many trailing steps to re-fetch on each ACTIVE poll.
 *
 * HACK: The LS provides no per-step change notification, so we brute-force
 * detect in-place status transitions (e.g. PENDING → WAITING after a
 * permission approval) by re-fetching a trailing window.
 * overlap=1 only catches the LAST step; 20 covers typical parallel
 * tool-call bursts (agents rarely have >10 concurrent tool steps).
 * If a status change falls outside this window, the frontend's
 * soft-refresh safety net will catch it on the next cycle.
 */
const ACTIVE_OVERLAP = 20;

/** Consecutive polls with no step-count growth before checking terminal status. */
const EMPTY_THRESHOLD = 3;

/**
 * Minimum time (ms) to stay ACTIVE after an activation signal.
 *
 * HACK: The LS may report CASCADE_RUN_STATUS_IDLE for a brief period
 * between receiving a user action (message, permission) and actually
 * starting execution. Without a "processing started" signal from the LS,
 * we use a time-based guard. 5s is conservative for a local LS; in
 * practice the transition takes <500ms.
 */
const MIN_ACTIVE_MS = 5000;

/** Terminal cascade run statuses — agent is definitively done. */
const TERMINAL_STATUSES = new Set([
  "CASCADE_RUN_STATUS_IDLE",
  "CASCADE_RUN_STATUS_ERROR",
  "CASCADE_RUN_STATUS_UNLOADED",
]);

type PollState = "idle" | "active";

type UpgradeValidationResult =
  | { ok: true; cascadeId: string }
  | { ok: false; code: "not_found" | "forbidden_origin" };

function unrefTimer(
  timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>,
): void {
  timer.unref?.();
}

export function getActivePollFetchOffset(
  lastStepCount: number,
  minFetchOffset: number,
  withOverlap: boolean,
): number {
  if (!withOverlap || lastStepCount <= 0) {
    return Math.max(lastStepCount, minFetchOffset);
  }
  return Math.max(minFetchOffset, lastStepCount - ACTIVE_OVERLAP);
}

export function shouldActivateIdlePolling(
  lastStepCount: number,
  status?: string,
  totalStepCount?: number,
): boolean {
  return (
    status === "CASCADE_RUN_STATUS_RUNNING" ||
    (totalStepCount ?? 0) > lastStepCount
  );
}

export function buildRecoverableStepDelta(
  knownEndOffset: number,
  minFetchOffset: number,
  nextValidOffset: number,
  reason: string,
): {
  offset: number;
  steps: ReturnType<typeof placeholderStep>[];
  nextEndOffset: number;
  nextMinFetchOffset: number;
  grew: boolean;
} {
  const offset = Math.max(knownEndOffset, minFetchOffset);
  const placeholderCount = Math.max(0, nextValidOffset - offset);

  return {
    offset,
    steps: Array.from({ length: placeholderCount }, () => placeholderStep(reason)),
    nextEndOffset: Math.max(knownEndOffset, nextValidOffset),
    nextMinFetchOffset: Math.max(minFetchOffset, nextValidOffset),
    grew: nextValidOffset > knownEndOffset,
  };
}

export function isWebSocketOriginAllowed(
  origin: string | undefined,
  allowedOrigins: AllowedOrigin[] = getAllowedOrigins(),
): boolean {
  // Browsers always send Origin for WS. Allowing missing Origin keeps
  // non-browser local clients working while blocking browser cross-origin use.
  return !origin || isAllowedOrigin(origin, allowedOrigins);
}

export function validateWebSocketUpgrade(
  reqUrl: string | undefined,
  origin: string | undefined,
  port: number,
  allowedOrigins: AllowedOrigin[] = getAllowedOrigins(),
): UpgradeValidationResult {
  const url = new URL(reqUrl ?? "", `http://localhost:${port}`);
  const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/ws$/);
  if (!match) {
    return { ok: false, code: "not_found" };
  }
  if (!isWebSocketOriginAllowed(origin, allowedOrigins)) {
    return { ok: false, code: "forbidden_origin" };
  }
  return { ok: true, cascadeId: match[1] };
}

export function setupWebSocket(
  server: { on: Function },
  port: number,
  allowedOrigins: AllowedOrigin[] = getAllowedOrigins(),
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const upgrade = validateWebSocketUpgrade(
      req.url,
      req.headers.origin,
      port,
      allowedOrigins,
    );

    if (!upgrade.ok) {
      if (upgrade.code === "forbidden_origin") {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      } else {
        socket.destroy();
      }
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, upgrade.cascadeId);
    });
  });

  wss.on(
    "connection",
    (ws: WebSocket, _req: IncomingMessage, cascadeId: string) => {
      const shortId = cascadeId.slice(0, 8);
      console.log(`[ws:${shortId}] connected`);

      let lastStepCount = 0;
      // Once a fetch proves some earlier offset is poison, never overlap before it again.
      let minFetchOffset = 0;
      let destroyed = false;
      let pollState: PollState = "idle";
      let pendingTimer: ReturnType<typeof setTimeout> | null = null;
      let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
      let emptyCount = 0;
      let minActiveUntil = 0;
      let peerAlive = true;

      // ── Helpers ──

      const cancelTimer = () => {
        if (pendingTimer !== null) {
          clearTimeout(pendingTimer);
          pendingTimer = null;
        }
      };

      const cancelKeepAlive = () => {
        if (keepAliveTimer !== null) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
      };

      const ensureKeepAlive = () => {
        if (destroyed || keepAliveTimer !== null) return;
        keepAliveTimer = setInterval(() => {
          if (destroyed || ws.readyState !== WebSocket.OPEN) return;
          if (!peerAlive) {
            console.warn(`[ws:${shortId}] heartbeat timeout`);
            ws.terminate();
            return;
          }
          peerAlive = false;
          try {
            ws.ping();
          } catch {
            ws.terminate();
          }
        }, SOCKET_KEEPALIVE_INTERVAL);
        unrefTimer(keepAliveTimer);
      };

      const pushStatus = (running: boolean) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "status", running }));
        }
      };

      // ── State transitions ──

      const enterActive = (guard = true) => {
        if (destroyed) return;
        // Always extend the guard period, even if already active
        // (e.g. permission approval while the agent is running).
        if (guard) {
          minActiveUntil = Date.now() + MIN_ACTIVE_MS;
        } else if (pollState !== "active") {
          minActiveUntil = 0;
        }
        if (pollState === "active") return; // Already polling
        pollState = "active";
        emptyCount = 0;
        console.log(`[ws:${shortId}] → ACTIVE`);
        pushStatus(true);
        cancelTimer();
        scheduleNext(0);
      };

      const enterIdle = () => {
        if (destroyed) return;
        const wasActive = pollState === "active";
        pollState = "idle";
        emptyCount = 0;
        minActiveUntil = 0;
        cancelTimer();
        if (wasActive) {
          console.log(`[ws:${shortId}] → IDLE`);
          pushStatus(false);
        }
        scheduleHeartbeat();
      };

      // ── Core: fetch & push ──

      /**
       * Fetch steps and push to the client.
       *
       * @param withOverlap  Re-fetch the last step to capture in-place
       *   streaming updates. The LS writes PLANNER_RESPONSE content without
       *   incrementing the step count, so overlap is the only way to see
       *   partial text during generation.
       * @returns Whether the step COUNT grew (for deactivation logic).
       *   Overlap-only updates (same count, new text) return false.
       */
      const fetchAndPush = async (withOverlap = false): Promise<boolean> => {
        if (destroyed) return false;
        try {
          const fetchOffset = getActivePollFetchOffset(
            lastStepCount,
            minFetchOffset,
            withOverlap,
          );

          const data = (await rpcForConversation(
            "GetCascadeTrajectorySteps",
            cascadeId,
            { cascadeId, stepOffset: fetchOffset },
            undefined,
            true,
          )) as { steps?: unknown[] };

          const newSteps = data.steps ?? [];
          if (newSteps.length === 0) return false;
          const annotatedSteps = messageTracker.annotateSteps(
            cascadeId,
            fetchOffset,
            newSteps,
          );

          const newEnd = fetchOffset + newSteps.length;
          const stepCountGrew = newEnd > lastStepCount;

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "steps",
                offset: fetchOffset,
                steps: annotatedSteps,
              }),
            );
          }

          lastStepCount = newEnd;
          return stepCountGrew;
        } catch (err) {
          const badOffset = oversizedStepOffset(err);
          if (badOffset >= 0) {
            const delta = buildRecoverableStepDelta(
              lastStepCount,
              minFetchOffset,
              badOffset + 1,
              "Language Server: step exceeds 4MB protobuf limit",
            );
            minFetchOffset = delta.nextMinFetchOffset;
            lastStepCount = delta.nextEndOffset;
            if (delta.steps.length > 0 && ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "steps",
                  offset: delta.offset,
                  steps: delta.steps,
                }),
              );
            }
            return delta.grew;
          } else if (isRecoverableStepError(err)) {
            try {
              const { count: total } = await getStepCount(cascadeId, undefined, true);
              const nextValid = await findNextValidOffset(
                cascadeId,
                Math.max(lastStepCount, minFetchOffset),
                total,
              );
              const delta = buildRecoverableStepDelta(
                lastStepCount,
                minFetchOffset,
                nextValid,
                "Language Server: invalid UTF-8 in step data",
              );
              minFetchOffset = delta.nextMinFetchOffset;
              lastStepCount = delta.nextEndOffset;
              if (delta.steps.length > 0 && ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: "steps",
                    offset: delta.offset,
                    steps: delta.steps,
                  }),
                );
              }
              return delta.grew;
            } catch {
              const delta = buildRecoverableStepDelta(
                lastStepCount,
                minFetchOffset,
                lastStepCount + 1,
                "Language Server: invalid UTF-8 in step data",
              );
              minFetchOffset = delta.nextMinFetchOffset;
              lastStepCount = delta.nextEndOffset;
              if (delta.steps.length > 0 && ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: "steps",
                    offset: delta.offset,
                    steps: delta.steps,
                  }),
                );
              }
              return delta.grew;
            }
          }
          return false;
        }
      };

      /** Is the conversation definitively stopped? */
      const isDefinitelyDone = async (): Promise<boolean> => {
        try {
          const data = (await rpcForConversation(
            "GetCascadeTrajectory",
            cascadeId,
            { cascadeId },
            undefined,
            true,
          )) as { status?: string };
          return TERMINAL_STATUSES.has(data.status ?? "");
        } catch {
          return false; // RPC failure — stay active to be safe
        }
      };

      // ── Polling loop ──

      const scheduleNext = (delay: number) => {
        if (destroyed) return;
        pendingTimer = setTimeout(async () => {
          pendingTimer = null;
          if (destroyed || pollState !== "active") return;

          const grew = await fetchAndPush(true);

          if (grew) {
            emptyCount = 0;
          } else {
            emptyCount++;
          }

          if (emptyCount >= EMPTY_THRESHOLD) {
            // Guard period: don't deactivate too early after an activation
            // signal. The LS may be slow to transition from IDLE to RUNNING.
            if (Date.now() < minActiveUntil) {
              emptyCount = 0;
            } else if (await isDefinitelyDone()) {
              enterIdle();
              return;
            } else {
              emptyCount = 0; // Not done — reset (e.g. "Thinking" phase)
            }
          }

          if (!destroyed && pollState === "active") {
            scheduleNext(ACTIVE_INTERVAL);
          }
        }, delay);
        unrefTimer(pendingTimer);
      };

      const scheduleHeartbeat = () => {
        if (destroyed || pollState !== "idle" || pendingTimer !== null) return;
        pendingTimer = setTimeout(async () => {
          pendingTimer = null;
          if (destroyed || pollState !== "idle") return;

          try {
            const data = (await rpcForConversation(
              "GetCascadeTrajectory",
              cascadeId,
              { cascadeId },
              undefined,
              true,
            )) as { status?: string; numTotalSteps?: number };

            if (
              shouldActivateIdlePolling(
                lastStepCount,
                data.status,
                data.numTotalSteps,
              )
            ) {
              // Heartbeat only observes already-visible server state, so it
              // doesn't need the post-activation grace period used for REST
              // signals while the LS is still spinning up.
              enterActive(false);
              return;
            }
          } catch {
            // LS unreachable — stay idle and retry later.
          }

          if (!destroyed && pollState === "idle") {
            scheduleHeartbeat();
          }
        }, HEARTBEAT_INTERVAL);
        unrefTimer(pendingTimer);
      };

      // ── Cross-module activation (REST → WS) ──

      const onActivate = (id: string) => {
        if (id !== cascadeId || destroyed) return;
        enterActive();
      };
      conversationSignals.on("activate", onActivate);

      // ── Connection lifecycle ──

      const onConnect = async () => {
        let status = "";
        try {
          const data = (await rpcForConversation(
            "GetCascadeTrajectory",
            cascadeId,
            { cascadeId },
            undefined,
            true,
          )) as { numTotalSteps?: number; status?: string };

          const total = data.numTotalSteps ?? 0;
          status = data.status ?? "";
          lastStepCount = total;

          if (ws.readyState === WebSocket.OPEN) {
            console.log(
              `[ws:${shortId}] ready stepCount=${total} status=${status}`,
            );
            ws.send(JSON.stringify({ type: "ready", stepCount: total }));
          }
        } catch {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ready", stepCount: 0 }));
          }
        }

        if (status === "CASCADE_RUN_STATUS_RUNNING") {
          enterActive();
        } else {
          enterIdle();
        }
      };

      ws.on("message", (raw) => {
        peerAlive = true;
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "sync" && typeof msg.fromOffset === "number") {
            lastStepCount = msg.fromOffset;
            fetchAndPush(); // Catch up on missed steps (no overlap, no state change)
          } else if (msg.type === "refresh") {
            lastStepCount = 0;
            minFetchOffset = 0;
            enterActive();
          }
        } catch {}
      });

      const cleanup = () => {
        destroyed = true;
        cancelTimer();
        cancelKeepAlive();
        conversationSignals.off("activate", onActivate);
      };

      ws.on("pong", () => {
        peerAlive = true;
      });

      ws.on("close", () => {
        console.log(`[ws:${shortId}] closed`);
        cleanup();
      });
      ws.on("error", cleanup);

      ensureKeepAlive();
      onConnect();
    },
  );
}
