/**
 * Tests for readOnly routing, write-path safety, and disk-only getStepCount.
 *
 * Covers:
 *   1. discoverOwnerInstance with readOnly=true: RUNNING status as owner signal
 *      when no workspace metadata.
 *   2. discoverOwnerInstance with readOnly=false: returns null when no workspace
 *      metadata, preventing mutation misrouting.
 *   3. readOnly try-all: status-aware sorting (RUNNING > non-RUNNING > stepCount).
 *   4. getStepCount with readOnly=true: resolves disk-only conversations.
 *   5. Mutation misroute prevention: writes to conversations without workspace
 *      metadata must fail, not route to a heuristic guess.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LSInstance } from "../discovery.js";
import { RPCError } from "../rpc.js";

// ── Mocks ──
const mockGetInstances = vi.fn<() => Promise<LSInstance[]>>();
const mockRpcCall = vi.fn<(method: string, body: unknown, inst: LSInstance) => Promise<unknown>>();

vi.mock("../discovery.js", () => {
  class MockLSDiscovery {
    getInstances = mockGetInstances;
    getInstance = async () => {
      const instances = await mockGetInstances();
      return instances[0] ?? null;
    };
  }
  return { LSDiscovery: MockLSDiscovery };
});

vi.mock("../rpc.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  class MockRPCClient {
    call = mockRpcCall;
  }
  return { ...actual, RPCClient: MockRPCClient };
});

// Import AFTER mocks
const {
  resolveAndCall,
  getStepCount,
  conversationAffinity,
  conversationInstanceAffinity,
  discoverOwnerInstance,
} = await import("../routing.js");

const makeInstance = (overrides: Partial<LSInstance> = {}): LSInstance => ({
  pid: 1000 + Math.floor(Math.random() * 9000),
  httpsPort: 9000 + Math.floor(Math.random() * 1000),
  httpPort: 0,
  lspPort: 0,
  csrfToken: "test-csrf",
  source: "daemon" as const,
  ...overrides,
});

// ─── discoverOwnerInstance ───

describe("discoverOwnerInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationAffinity.clear();
    conversationInstanceAffinity.clear();
  });

  it("returns null when no LS knows about the conversation", async () => {
    const ls = makeInstance({ pid: 1 });
    mockRpcCall.mockResolvedValue({ trajectorySummaries: {} });
    expect(await discoverOwnerInstance("unknown", [ls])).toBeNull();
  });

  it("routes to workspace-matched LS when metadata is present (any readOnly)", async () => {
    const ownerLS = makeInstance({ pid: 2, workspaceId: "file_home_user_projectA" });
    const otherLS = makeInstance({ pid: 3, workspaceId: "file_home_user_projectB" });

    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c1": {
          stepCount: 30,
          status: "CASCADE_RUN_STATUS_IDLE",
          workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/projectA" }],
        },
      },
    });

    // Works for both readOnly=true and readOnly=false
    expect(await discoverOwnerInstance("c1", [ownerLS, otherLS], true)).toBe(ownerLS);
    expect(await discoverOwnerInstance("c1", [ownerLS, otherLS], false)).toBe(ownerLS);
  });

  it("routes to a single unscoped hub LS when workspace metadata is present", async () => {
    const hubLS = makeInstance({ pid: 4, workspaceId: undefined });

    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c-hub": {
          stepCount: 30,
          status: "CASCADE_RUN_STATUS_IDLE",
          workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/projectA" }],
        },
      },
    });

    expect(await discoverOwnerInstance("c-hub", [hubLS], true)).toBe(hubLS);
    expect(await discoverOwnerInstance("c-hub", [hubLS], false)).toBe(hubLS);
  });

  it("keeps writes conservative when multiple unscoped LSes report a workspace-backed conversation", async () => {
    const hubA = makeInstance({ pid: 5, workspaceId: undefined });
    const hubB = makeInstance({ pid: 6, workspaceId: undefined });

    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c-ambiguous": {
          stepCount: 30,
          status: "CASCADE_RUN_STATUS_IDLE",
          workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/projectA" }],
        },
      },
    });

    expect(
      await discoverOwnerInstance("c-ambiguous", [hubA, hubB], false),
    ).toBeNull();
  });

  it("uses RUNNING status for read-only resolution when multiple unscoped LSes report metadata", async () => {
    const idleLS = makeInstance({ pid: 7, workspaceId: undefined });
    const runningLS = makeInstance({ pid: 8, workspaceId: undefined });

    mockRpcCall.mockImplementation(async (_method: string, _body: unknown, inst: LSInstance) => ({
      trajectorySummaries: {
        "c-read-hub": {
          stepCount: inst === idleLS ? 100 : 50,
          status:
            inst === runningLS
              ? "CASCADE_RUN_STATUS_RUNNING"
              : "CASCADE_RUN_STATUS_IDLE",
          workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/projectA" }],
        },
      },
    }));

    expect(
      await discoverOwnerInstance("c-read-hub", [idleLS, runningLS], true),
    ).toBe(runningLS);
  });

  it("picks RUNNING LS when readOnly=true and no workspace metadata", async () => {
    const staleLS = makeInstance({ pid: 10, workspaceId: "ws_stale" });
    const runningLS = makeInstance({ pid: 11, workspaceId: "ws_running" });

    mockRpcCall.mockImplementation(async (_method: string, _body: unknown, inst: LSInstance) => {
      if (inst === staleLS) {
        return {
          trajectorySummaries: {
            "c2": { stepCount: 50, status: "CASCADE_RUN_STATUS_IDLE" },
          },
        };
      }
      return {
        trajectorySummaries: {
          "c2": { stepCount: 50, status: "CASCADE_RUN_STATUS_RUNNING" },
        },
      };
    });

    const owner = await discoverOwnerInstance("c2", [staleLS, runningLS], true);
    expect(owner).toBe(runningLS);
  });

  it("returns null when readOnly=false and no workspace metadata (CRITICAL: write safety)", async () => {
    const staleLS = makeInstance({ pid: 10, workspaceId: "ws_stale" });
    const runningLS = makeInstance({ pid: 11, workspaceId: "ws_running" });

    mockRpcCall.mockImplementation(async (_method: string, _body: unknown, inst: LSInstance) => {
      if (inst === staleLS) {
        return {
          trajectorySummaries: {
            "c-write-safe": { stepCount: 50, status: "CASCADE_RUN_STATUS_IDLE" },
          },
        };
      }
      return {
        trajectorySummaries: {
          "c-write-safe": { stepCount: 50, status: "CASCADE_RUN_STATUS_RUNNING" },
        },
      };
    });

    // Even though a RUNNING LS exists, write path must NOT use heuristics
    const owner = await discoverOwnerInstance("c-write-safe", [staleLS, runningLS], false);
    expect(owner).toBeNull();
  });

  it("routes writes to a single unscoped hub LS even without workspace metadata", async () => {
    const hubLS = makeInstance({ pid: 12, workspaceId: undefined });

    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c-new-empty": {
          stepCount: 0,
          status: "CASCADE_RUN_STATUS_IDLE",
        },
      },
    });

    expect(await discoverOwnerInstance("c-new-empty", [hubLS], false)).toBe(
      hubLS,
    );
    expect(conversationInstanceAffinity.get("c-new-empty")).toBe(hubLS);
  });

  it("picks RUNNING LS even with lower stepCount (readOnly=true)", async () => {
    const highCountLS = makeInstance({ pid: 20, workspaceId: "ws_high" });
    const runningLS = makeInstance({ pid: 21, workspaceId: "ws_run" });

    mockRpcCall.mockImplementation(async (_method: string, _body: unknown, inst: LSInstance) => {
      if (inst === highCountLS) {
        return {
          trajectorySummaries: {
            "c3": { stepCount: 100, status: "CASCADE_RUN_STATUS_IDLE" },
          },
        };
      }
      return {
        trajectorySummaries: {
          "c3": { stepCount: 50, status: "CASCADE_RUN_STATUS_RUNNING" },
        },
      };
    });

    const owner = await discoverOwnerInstance("c3", [highCountLS, runningLS], true);
    expect(owner).toBe(runningLS);
  });

  it("falls back to highest stepCount when nobody is RUNNING (readOnly=true)", async () => {
    const lowLS = makeInstance({ pid: 30, workspaceId: "ws_low" });
    const highLS = makeInstance({ pid: 31, workspaceId: "ws_high" });

    mockRpcCall.mockImplementation(async (_method: string, _body: unknown, inst: LSInstance) => {
      if (inst === lowLS) {
        return {
          trajectorySummaries: {
            "c4": { stepCount: 10, status: "CASCADE_RUN_STATUS_IDLE" },
          },
        };
      }
      return {
        trajectorySummaries: {
          "c4": { stepCount: 50, status: "CASCADE_RUN_STATUS_IDLE" },
        },
      };
    });

    const owner = await discoverOwnerInstance("c4", [lowLS, highLS], true);
    expect(owner).toBe(highLS);
  });

  it("does NOT learn affinity when resolving via status heuristic", async () => {
    const ls = makeInstance({ pid: 40, workspaceId: "ws_test" });

    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c5": { stepCount: 10, status: "CASCADE_RUN_STATUS_RUNNING" },
      },
    });

    await discoverOwnerInstance("c5", [ls], true);
    expect(conversationAffinity.has("c5")).toBe(false);
  });

  it("DOES learn affinity when resolving via workspace metadata", async () => {
    const ls = makeInstance({ pid: 41, workspaceId: "file_home_user_proj" });

    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c6": {
          stepCount: 10,
          workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/proj" }],
        },
      },
    });

    await discoverOwnerInstance("c6", [ls], false);
    expect(conversationAffinity.has("c6")).toBe(true);
  });
});

// ─── resolveAndCall: write-path safety ───

describe("resolveAndCall write-path safety (mutation misrouting prevention)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationAffinity.clear();
    conversationInstanceAffinity.clear();
  });

  it("rejects mutations when conversation has no workspace metadata (warm-up loaded)", async () => {
    const ls1 = makeInstance({ pid: 70, workspaceId: "ws_a" });
    const ls2 = makeInstance({ pid: 71, workspaceId: "ws_b" });
    mockGetInstances.mockResolvedValue([ls1, ls2]);

    // Both LSes have the conversation in memory (e.g. after warm-up)
    // but WITHOUT workspace metadata — a legacy or disk-only conversation
    mockRpcCall.mockImplementation(async (method: string, _body: unknown, inst: LSInstance) => {
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            "cascade-no-ws": {
              stepCount: 50,
              status: inst === ls1
                ? "CASCADE_RUN_STATUS_IDLE"
                : "CASCADE_RUN_STATUS_IDLE",
            },
          },
        };
      }
      // This should NEVER be reached for write path
      return { ok: true };
    });

    // readOnly=false: must throw, not route to a heuristic guess
    await expect(
      resolveAndCall(
        "SendUserCascadeMessage",
        "cascade-no-ws",
        { cascadeId: "cascade-no-ws", items: [] },
        undefined,
        false,
      ),
    ).rejects.toThrow("not found on any Language Server");
  });

  it("allows mutations through a single unscoped hub LS with workspace metadata", async () => {
    const hubLS = makeInstance({ pid: 72, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);

    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            "cascade-hub": {
              stepCount: 50,
              status: "CASCADE_RUN_STATUS_IDLE",
              workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/proj" }],
            },
          },
        };
      }
      return { ok: true };
    });

    await expect(
      resolveAndCall(
        "SendUserCascadeMessage",
        "cascade-hub",
        { cascadeId: "cascade-hub", items: [] },
        undefined,
        false,
      ),
    ).resolves.toMatchObject({ data: { ok: true }, instance: hubLS });
  });

  it("uses cached unscoped hub ownership for follow-up writes after StartCascade", async () => {
    const hubLS = makeInstance({ pid: 73, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);
    conversationInstanceAffinity.set("new-cascade", hubLS);

    mockRpcCall.mockResolvedValue({ ok: true });

    await expect(
      resolveAndCall(
        "SendUserCascadeMessage",
        "new-cascade",
        { cascadeId: "new-cascade", items: [] },
        undefined,
        false,
      ),
    ).resolves.toMatchObject({ data: { ok: true }, instance: hubLS });

    expect(mockRpcCall).toHaveBeenCalledTimes(1);
    expect(mockRpcCall).toHaveBeenCalledWith(
      "SendUserCascadeMessage",
      { cascadeId: "new-cascade", items: [] },
      hubLS,
    );
  });

  it("allows reads for the same conversation that rejects writes", async () => {
    const ls1 = makeInstance({ pid: 72, workspaceId: "ws_c" });
    mockGetInstances.mockResolvedValue([ls1]);

    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            "cascade-read-ok": {
              stepCount: 50,
              status: "CASCADE_RUN_STATUS_IDLE",
            },
          },
        };
      }
      return { numTotalSteps: 50 };
    });

    // readOnly=true: should succeed (heuristic routing is safe for reads)
    const result = await resolveAndCall(
      "GetCascadeTrajectory",
      "cascade-read-ok",
      { cascadeId: "cascade-read-ok" },
      undefined,
      true,
    );
    expect(result.instance).toBe(ls1);
  });

  it("getStepCount(readOnly=false) does not return heuristic instance for pinning", async () => {
    const ls = makeInstance({ pid: 73, workspaceId: "ws_d" });
    mockGetInstances.mockResolvedValue([ls]);

    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            "cascade-pin-safe": {
              stepCount: 50,
              status: "CASCADE_RUN_STATUS_IDLE",
            },
          },
        };
      }
      throw new RPCError("not found", "not_found");
    });

    // Default readOnly=false: must return count=0 and undefined instance,
    // NOT a heuristic instance that would be pinned for SendUserCascadeMessage
    const result = await getStepCount("cascade-pin-safe");
    expect(result.count).toBe(0);
    expect(result.instance).toBeUndefined();
  });
});

// ─── readOnly try-all (resolveAndCall) ───

describe("readOnly try-all fallback (resolveAndCall)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationAffinity.clear();
  });

  it("picks RUNNING LS in try-all (status from GetCascadeTrajectory response)", async () => {
    const staleLS = makeInstance({ pid: 50, workspaceId: "ws_s" });
    const freshLS = makeInstance({ pid: 51, workspaceId: "ws_f" });

    mockGetInstances.mockResolvedValue([staleLS, freshLS]);

    // No candidates in GetAllCascadeTrajectories → try-all
    mockRpcCall.mockImplementation(async (method: string, _body: unknown, inst: LSInstance) => {
      if (method === "GetAllCascadeTrajectories") {
        return { trajectorySummaries: {} };
      }
      if (inst === staleLS) {
        return { numTotalSteps: 50, status: "CASCADE_RUN_STATUS_IDLE" };
      }
      return { numTotalSteps: 50, status: "CASCADE_RUN_STATUS_RUNNING" };
    });

    const result = await resolveAndCall(
      "GetCascadeTrajectory",
      "cascade-try-all",
      { cascadeId: "cascade-try-all" },
      undefined,
      true,
    );

    expect(result.instance).toBe(freshLS);
    expect((result.data as { status: string }).status).toBe("CASCADE_RUN_STATUS_RUNNING");
  });

  it("returns the sole successful instance when others fail", async () => {
    const goodLS = makeInstance({ pid: 52, workspaceId: "ws_good" });
    const brokenLS = makeInstance({ pid: 53, workspaceId: "ws_broken" });

    mockGetInstances.mockResolvedValue([brokenLS, goodLS]);

    mockRpcCall.mockImplementation(async (method: string, _body: unknown, inst: LSInstance) => {
      if (method === "GetAllCascadeTrajectories") {
        return { trajectorySummaries: {} };
      }
      if (inst === brokenLS) {
        throw new RPCError("unavailable", "unavailable");
      }
      return { numTotalSteps: 20 };
    });

    const result = await resolveAndCall(
      "GetCascadeTrajectory",
      "cascade-sole",
      { cascadeId: "cascade-sole" },
      undefined,
      true,
    );

    expect(result.instance).toBe(goodLS);
  });

  it("throws when all instances fail in readOnly try-all", async () => {
    const ls1 = makeInstance({ pid: 55 });
    const ls2 = makeInstance({ pid: 56 });

    mockGetInstances.mockResolvedValue([ls1, ls2]);

    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetAllCascadeTrajectories") {
        return { trajectorySummaries: {} };
      }
      throw new RPCError("not found", "not_found");
    });

    await expect(
      resolveAndCall(
        "GetCascadeTrajectory",
        "cascade-fail",
        { cascadeId: "cascade-fail" },
        undefined,
        true,
      ),
    ).rejects.toThrow("not found");
  });
});

// ─── getStepCount ───

describe("getStepCount with readOnly parameter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationAffinity.clear();
  });

  it("returns count=0 for disk-only conversation with readOnly=false (default)", async () => {
    const ls = makeInstance({ pid: 60, workspaceId: "ws_a" });
    mockGetInstances.mockResolvedValue([ls]);

    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetAllCascadeTrajectories") {
        return { trajectorySummaries: {} };
      }
      throw new RPCError("not found", "not_found");
    });

    const result = await getStepCount("disk-only-cascade");
    expect(result.count).toBe(0);
    expect(result.instance).toBeUndefined();
  });

  it("resolves disk-only conversation count with readOnly=true", async () => {
    const ls = makeInstance({ pid: 61, workspaceId: "ws_b" });
    mockGetInstances.mockResolvedValue([ls]);

    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetAllCascadeTrajectories") {
        return { trajectorySummaries: {} };
      }
      return { numTotalSteps: 42 };
    });

    const result = await getStepCount("disk-only-cascade", undefined, true);
    expect(result.count).toBe(42);
    expect(result.instance).toBe(ls);
  });
});
