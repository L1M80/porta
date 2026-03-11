/**
 * /api/conversations/* routes
 */

import type { Hono } from "hono";
import type { LSInstance } from "../discovery.js";
import {
  discovery,
  rpc,
  conversationAffinity,
  uriToWorkspaceId,
  normalizeWorkspaceId,
  rpcForConversation,
  getStepCount,
} from "../routing.js";
import { getMetadata, scanDiskConversations } from "../metadata.js";
import { handleRPCError } from "../errors.js";
import { runConversationMutation } from "../conversation-mutations.js";
import {
  oversizedStepOffset,
  isRecoverableStepError,
  findNextValidOffset,
  placeholderStep,
  MAX_SKIP,
} from "../step-recovery.js";
import { messageTracker } from "../message-tracker.js";
import { conversationSignals } from "../signals.js";

// ── Background warm-up for disk-only conversations ──

/** Warm-up cache: cascadeId → timestamp when the warm-up was initiated. */
const warmedAt = new Map<string, number>();
/** How long a warm-up result is considered valid (ms). After this, the
 *  conversation will be re-warmed on the next poll if still disk-only.
 *  This handles LS restarts (conversations fall out of memory) and
 *  transient failures without manual intervention. */
const WARM_TTL_MS = 60_000;

/**
 * Fire-and-forget: touch each disk-only conversation on every LS so the LS
 * loads its .pb file into memory. On the *next* GetAllCascadeTrajectories call
 * the LS will return it with proper workspace metadata and summary.
 *
 * Uses GetCascadeTrajectorySteps with a huge offset so the LS loads the .pb
 * but returns only `{steps:[]}` (~28 bytes) instead of the full trajectory.
 *
 * HACK: There is no dedicated "load conversation" RPC on the LS. We rely on
 * the side-effect of GetCascadeTrajectorySteps loading the .pb from disk.
 * If the LS changes its boundary-check or authorization behavior, this may
 * silently stop working — watch for "warm-up: failed" log lines.
 *
 * Concurrency is capped to avoid flooding the LS with reads.
 */
function warmUpDiskConversations(
  ids: string[],
  instances: LSInstance[],
): void {
  const now = Date.now();
  const pending = ids.filter((id) => {
    const t = warmedAt.get(id);
    return !t || now - t > WARM_TTL_MS;
  });
  if (pending.length === 0) return;
  for (const id of pending) warmedAt.set(id, now);

  console.log(
    `[warm-up] loading ${pending.length} disk-only conversation(s) across ${instances.length} LS(es)`,
  );

  const CONCURRENCY = 10;

  void (async () => {
    let loaded = 0;
    let failed = 0;

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (cascadeId) => {
          for (const inst of instances) {
            try {
              await rpc.call(
                "GetCascadeTrajectorySteps",
                { cascadeId, stepOffset: 999999 },
                inst,
              );
              loaded++;
              return;
            } catch {
              // This LS doesn't have it — try next
            }
          }
          // No LS could load it — expire immediately so next poll retries
          warmedAt.delete(cascadeId);
          failed++;
        }),
      );
    }

    if (failed > 0) {
      console.log(
        `[warm-up] done: ${loaded} loaded, ${failed} failed (no LS could load them)`,
      );
    } else {
      console.log(`[warm-up] done: ${loaded} loaded`);
    }
  })();
}


export function registerConversationRoutes(app: Hono): void {
  app.get("/api/conversations", async (c) => {
    try {
      const instances = await discovery.getInstances();
      const merged: Record<string, Record<string, unknown>> = {};
      const ownerMap = new Map<string, LSInstance>();

      // Build normalized set of workspaceIds served by running LS instances.
      // Normalization handles format differences between CLI --workspace_id
      // (e.g. file_e_3A_Work_novels) and URI-derived IDs (e.g. file_E:_Work_novels).
      const knownWsIds = new Set(
        instances
          .map((i) => i.workspaceId)
          .filter(Boolean)
          .map((id) => normalizeWorkspaceId(id!)),
      );

      await Promise.allSettled(
        instances.map(async (inst) => {
          try {
            const data = await rpc.call<{
              trajectorySummaries: Record<string, Record<string, unknown>>;
            }>("GetAllCascadeTrajectories", {}, inst);
            const summaries = data.trajectorySummaries ?? {};
            for (const [id, summary] of Object.entries(summaries)) {
              // Skip conversations whose workspace isn't served by any running LS
              const workspaces = summary.workspaces as
                | { workspaceFolderAbsoluteUri?: string }[]
                | undefined;
              const wsUri = workspaces?.[0]?.workspaceFolderAbsoluteUri;
              if (wsUri && !knownWsIds.has(normalizeWorkspaceId(uriToWorkspaceId(wsUri)))) continue;

              // NOTE: We intentionally do NOT inject the LS's workspace URI
              // into conversations that lack one. With warm-up loading .pb
              // files onto all LSes, the loading LS is not necessarily the
              // owner. Instead, we rely on the .pb itself containing the
              // correct workspace metadata — once warm-up loads it, the LS
              // returns it with genuine metadata on the next poll cycle.

              const existing = merged[id];
              const newCount = (summary.stepCount as number) ?? 0;
              const oldCount = (existing?.stepCount as number) ?? -1;
              if (!existing || newCount > oldCount) {
                merged[id] = summary;
                ownerMap.set(id, inst);
              }
            }
          } catch {
            // Skip unreachable instances
          }
        }),
      );

      // Update affinity cache from merged results
      for (const [id, summary] of Object.entries(merged)) {
        const workspaces = summary.workspaces as
          | { workspaceFolderAbsoluteUri?: string }[]
          | undefined;
        const wsUri = workspaces?.[0]?.workspaceFolderAbsoluteUri;
        if (wsUri) {
          conversationAffinity.set(id, uriToWorkspaceId(wsUri));
        }
        // NOTE: We intentionally do NOT learn affinity from the ownerMap
        // when the conversation has no workspace metadata. With warm-up,
        // the owning LS is not necessarily the one that returned the summary.
        // Affinity is only learned from genuine workspace metadata in the
        // conversation itself — either from the .pb or from the LS that
        // originally created it.
      }

      // Also scan disk for all .pb files
      const diskIds = await scanDiskConversations();

      // Merge: disk-only sessions get minimal placeholder metadata.
      // Actual workspace info will be resolved by the background warm-up below.
      const diskOnlyIds: string[] = [];
      for (const diskId of diskIds) {
        if (!merged[diskId.id]) {
          let injectedWorkspaces: { workspaceFolderAbsoluteUri: string }[] = [];
          const wsId = conversationAffinity.get(diskId.id);
          if (wsId && wsId.startsWith("file_")) {
            const uri = wsId.replace(/^file_/, "file:///").replace(/_/g, "/");
            injectedWorkspaces = [{ workspaceFolderAbsoluteUri: uri }];
          }

          // Always queue for warm-up, even with cached affinity.
          // Affinity may be stale (LS restarted, conversation fell out of
          // memory) — warm-up ensures the LS re-loads it from disk.
          diskOnlyIds.push(diskId.id);

          merged[diskId.id] = {
            summary: diskId.id.slice(0, 8) + "…",
            stepCount: 0,
            status: "CASCADE_RUN_STATUS_UNLOADED",
            lastModifiedTime: diskId.mtime,
            createdTime: diskId.mtime,
            trajectoryId: "",
            workspaces: injectedWorkspaces,
            _diskOnly: true,
          };
        }
      }

      // Background warm-up: touch disk-only conversations so each LS loads
      // them from .pb files. Once loaded, GetAllCascadeTrajectories returns
      // them with proper workspace metadata on the next poll cycle.
      if (diskOnlyIds.length > 0 && instances.length > 0) {
        warmUpDiskConversations(diskOnlyIds, instances);
      }

      return c.json({ trajectorySummaries: merged });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.get("/api/conversations/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const data = await rpcForConversation("GetCascadeTrajectory", id, {
        cascadeId: id,
      }, undefined, true);
      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.get("/api/conversations/:id/steps", async (c) => {
    const id = c.req.param("id");
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const limit = c.req.query("limit")
      ? parseInt(c.req.query("limit")!, 10)
      : undefined;

    try {
      let resolvedOffset = offset;
      let stepCount: number | undefined;
      let pinnedInstance: LSInstance | undefined;
      let stepsArray: unknown[] = [];

      if (c.req.query("tail")) {
        // readOnly=true: this endpoint only reads steps; the pinned instance
        // is NOT reused for mutations, so try-all fallback is safe and
        // necessary for disk-only conversations that no LS has in memory yet.
        const sc = await getStepCount(id, undefined, true);
        pinnedInstance = sc.instance;
        if (sc.count > 0) {
          stepCount = sc.count;
          const tailSize = parseInt(c.req.query("tail")!, 10);
          resolvedOffset = Math.max(0, stepCount - tailSize);
        }
      }

      // We need to fetch until we get what we came for, or we run out of steps.
      let currentOffset = resolvedOffset;
      const targetCount =
        limit ?? (stepCount ? stepCount - resolvedOffset : 100);
      let consecutiveSkips = 0;

      while (stepsArray.length < targetCount) {
        try {
          const data = await rpcForConversation<{ steps?: unknown[] }>(
            "GetCascadeTrajectorySteps",
            id,
            {
              cascadeId: id,
              stepOffset: currentOffset,
            },
            pinnedInstance,
            true,
          );

          const chunk = data.steps ?? [];
          if (chunk.length === 0) break;

          stepsArray.push(...chunk);
          currentOffset += chunk.length;
          consecutiveSkips = 0;
        } catch (fetchErr) {
          const badOffset = oversizedStepOffset(fetchErr);
          if (badOffset >= 0) {
            // Known oversized step — skip directly
            const skipCount = badOffset - currentOffset + 1;
            for (let s = 0; s < skipCount; s++)
              stepsArray.push(
                placeholderStep(
                  "Language Server: step exceeds 4MB protobuf limit",
                ),
              );
            currentOffset = badOffset + 1;
            consecutiveSkips += skipCount;
            if (consecutiveSkips >= MAX_SKIP) break;
          } else if (isRecoverableStepError(fetchErr)) {
            // Corrupted batch (e.g. invalid UTF-8) — binary search forward
            if (stepCount === undefined) {
              const sc = await getStepCount(id, undefined, true);
              stepCount = sc.count;
              pinnedInstance ??= sc.instance;
            }
            const nextValid = await findNextValidOffset(
              id,
              currentOffset + 1,
              stepCount,
              pinnedInstance,
            );
            const skipCount = nextValid - currentOffset;
            for (let s = 0; s < skipCount; s++)
              stepsArray.push(
                placeholderStep("Language Server: invalid UTF-8 in step data"),
              );
            console.log(
              `Skipping corrupted range [${currentOffset}, ${nextValid - 1}] (${skipCount} steps)`,
            );
            currentOffset = nextValid;
            consecutiveSkips += skipCount;
            if (consecutiveSkips >= MAX_SKIP) break;
          } else {
            throw fetchErr;
          }
        }
      }

      // If we overfetched because of chunks, slice it down to the exact limit requested
      if (stepsArray.length > targetCount) {
        stepsArray = stepsArray.slice(0, targetCount);
      }

      return c.json({
        steps: messageTracker.annotateSteps(id, resolvedOffset, stepsArray),
        offset: resolvedOffset,
        ...(stepCount !== undefined ? { stepCount } : {}),
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/conversations", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const metadata = await getMetadata(!!body.fileAccessGranted);

      let workspaceUri: string | undefined = body.workspaceFolderAbsoluteUri;

      // Resolve which LS instance to use based on workspace URI
      let targetInstance: LSInstance | undefined;
      if (workspaceUri) {
        const wsId = normalizeWorkspaceId(uriToWorkspaceId(workspaceUri));
        const instances = await discovery.getInstances();
        targetInstance =
          instances.find(
            (i) => i.workspaceId && normalizeWorkspaceId(i.workspaceId) === wsId,
          ) ?? undefined;

        // Workspace was explicitly requested but no LS owns it — fail clearly
        if (!targetInstance) {
          return c.json(
            {
              error:
                "No Language Server found for this workspace. Open the project in Antigravity first.",
              detail: workspaceUri,
            },
            503,
          );
        }
      } else {
        // No workspace specified — pick first available LS and auto-inject
        targetInstance = (await discovery.getInstance()) ?? undefined;
        try {
          const wsInfos = (await rpc.call(
            "GetWorkspaceInfos",
            {},
            targetInstance,
          )) as {
            workspaceInfos?: { workspaceUri: string }[];
          };
          workspaceUri = wsInfos.workspaceInfos?.[0]?.workspaceUri;
        } catch {
          // best-effort — proceed without workspace
        }
      }

      const data = await rpc.call(
        "StartCascade",
        {
          ...body,
          metadata,
          ...(workspaceUri ? { workspaceFolderAbsoluteUri: workspaceUri } : {}),
        },
        targetInstance,
      );

      // Learn affinity immediately
      const newId = (data as Record<string, unknown>)?.cascadeId as
        | string
        | undefined;
      if (newId && targetInstance?.workspaceId) {
        conversationAffinity.set(newId, targetInstance.workspaceId);
      }

      // Signal WS connections for this conversation to enter ACTIVE state
      if (newId) conversationSignals.emit("activate", newId);

      return c.json(data, 201);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/conversations/:id/messages", async (c) => {
    const id = c.req.param("id");
    try {
      return await runConversationMutation(id, async () => {
        const body = await c.req.json();
        const { items, model, media, plannerType, clientMessageId } = body;
        const metadata = await getMetadata(!!body.fileAccessGranted);
        const { count: preSendStepCount, instance } = await getStepCount(id);

        const req: Record<string, unknown> = {
          metadata,
          cascadeId: id,
          items,
        };

        if (media && Array.isArray(media) && media.length > 0) {
          req.media = media;
        }

        const typeConfig =
          plannerType === "planning" ? { planning: {} } : { conversational: {} };

        if (model || plannerType) {
          req.cascadeConfig = {
            plannerConfig: {
              plannerTypeConfig: typeConfig,
              ...(model ? { requestedModel: { model } } : {}),
            },
          };
        }

        const data = await rpcForConversation(
          "SendUserCascadeMessage",
          id,
          req,
          instance,
        );
        if (typeof clientMessageId === "string" && clientMessageId.length > 0) {
          messageTracker.trackPendingMessage(
            id,
            clientMessageId,
            preSendStepCount,
          );
        }
        conversationSignals.emit("activate", id);
        return c.json(data);
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Stop ──

  app.post("/api/conversations/:id/stop", async (c) => {
    const id = c.req.param("id");
    try {
      const data = await rpcForConversation("CancelCascadeInvocation", id, {
        cascadeId: id,
      });
      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Delete ──

  app.delete("/api/conversations/:id", async (c) => {
    const id = c.req.param("id");
    try {
      return await runConversationMutation(id, async () => {
        const metadata = await getMetadata(true);
        const data = await rpcForConversation("DeleteCascadeTrajectory", id, {
          metadata,
          cascadeId: id,
        });
        messageTracker.clearConversation(id);
        return c.json(data);
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Revert ──

  // ── File Permission ──

  app.post("/api/conversations/:id/file-permission", async (c) => {
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const { trajectoryId, stepIndex, allow, scope, absolutePathUri } = body;

      if (
        !trajectoryId ||
        stepIndex === undefined ||
        absolutePathUri === undefined
      ) {
        return c.json(
          {
            error:
              "Missing required fields: trajectoryId, stepIndex, absolutePathUri",
          },
          400,
        );
      }

      // Build HandleCascadeUserInteraction request with exact protobuf structure.
      // CRITICAL: top-level field is "interaction" (not "userInteraction"),
      // and it MUST include trajectoryId + stepIndex alongside filePermission.
      const data = await rpcForConversation(
        "HandleCascadeUserInteraction",
        id,
        {
          cascadeId: id,
          interaction: {
            trajectoryId,
            stepIndex: Number(stepIndex),
            filePermission: {
              allow: !!allow,
              scope: Number(scope) || 0,
              absolutePathUri,
            },
          },
        },
      );

      // Permission approval unblocks subsequent WAITING steps — wake WS polling
      conversationSignals.emit("activate", id);

      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  // ── Command Action (approve/reject proposed commands) ──

  app.post("/api/conversations/:id/command-action", async (c) => {
    const id = c.req.param("id");
    try {
      const body = await c.req.json();
      const { trajectoryId, stepIndex, approved } = body;

      if (!trajectoryId || stepIndex === undefined) {
        return c.json(
          {
            error:
              "Missing required fields: trajectoryId, stepIndex",
          },
          400,
        );
      }

      // Use HandleCascadeUserInteraction with commandAction field.
      // Same RPC as filePermission, different interaction type.
      const data = await rpcForConversation(
        "HandleCascadeUserInteraction",
        id,
        {
          cascadeId: id,
          interaction: {
            trajectoryId,
            stepIndex: Number(stepIndex),
            commandAction: {
              approved: !!approved,
            },
          },
        },
      );

      // Command approval/rejection unblocks the agent — wake WS polling
      conversationSignals.emit("activate", id);

      return c.json(data);
    } catch (err) {
      return handleRPCError(c, err);
    }
  });

  app.post("/api/conversations/:id/revert", async (c) => {
    const id = c.req.param("id");
    try {
      return await runConversationMutation(id, async () => {
        const body = await c.req.json();
        const metadata = await getMetadata(true);

        const req: Record<string, unknown> = {
          cascadeId: id,
          stepIndex: body.stepIndex,
          metadata,
        };

        if (body.model) {
          req.overrideConfig = {
            plannerConfig: {
              plannerTypeConfig: { conversational: {} },
              requestedModel: { model: body.model },
            },
          };
        }

        const data = await rpcForConversation("RevertToCascadeStep", id, req);
        messageTracker.clearConversation(id);
        conversationSignals.emit("activate", id);
        return c.json(data);
      });
    } catch (err) {
      return handleRPCError(c, err);
    }
  });
}
