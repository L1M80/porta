import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LSInstance } from "../discovery.js";
import { RPCError } from "../rpc.js";

const mockGetInstances = vi.fn<() => Promise<LSInstance[]>>();
const mockRpcCall = vi.fn<
  (method: string, body: unknown, inst: LSInstance) => Promise<unknown>
>();
const mockScanDiskConversations = vi.fn<
  (dirs?: string | string[]) => Promise<{ id: string; mtime: string }[]>
>();
const mockRpcForConversation = vi.fn();
const mockGetStepCount = vi.fn();

const conversationAffinity = new Map<string, string>();
const conversationInstanceAffinity = new Map<string, LSInstance>();

vi.mock("../routing.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    discovery: {
      getInstances: mockGetInstances,
      getInstance: async () => (await mockGetInstances())[0] ?? null,
    },
    rpc: { call: mockRpcCall },
    rpcForConversation: mockRpcForConversation,
    getStepCount: mockGetStepCount,
    conversationAffinity,
    conversationInstanceAffinity,
  };
});

vi.mock("../metadata.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    scanDiskConversations: mockScanDiskConversations,
  };
});

const { registerConversationRoutes } = await import("../routes/conversations.js");

const makeInstance = (overrides: Partial<LSInstance> = {}): LSInstance => ({
  pid: 1000 + Math.floor(Math.random() * 9000),
  httpsPort: 9000 + Math.floor(Math.random() * 1000),
  httpPort: 0,
  lspPort: 0,
  csrfToken: "test-csrf",
  source: "daemon" as const,
  ...overrides,
});

function app() {
  const hono = new Hono();
  registerConversationRoutes(hono);
  return hono;
}

describe("GET /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationAffinity.clear();
    conversationInstanceAffinity.clear();
    mockScanDiskConversations.mockResolvedValue([]);
  });

  it("keeps workspace-backed conversations from an unscoped Antigravity 2.x hub LS", async () => {
    const hubLS = makeInstance({ pid: 1, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);
    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c-hub": {
          summary: "Hub conversation",
          stepCount: 9,
          lastModifiedTime: "2026-06-01T00:00:00.000Z",
          workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/project" }],
        },
      },
    });

    const res = await app().request("/api/conversations");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body.trajectorySummaries)).toEqual(["c-hub"]);
    expect(conversationAffinity.get("c-hub")).toBe("file_home_user_project");
  });

  it("still filters scoped LS conversations for workspaces not served by any running scoped LS", async () => {
    const scopedLS = makeInstance({
      pid: 2,
      workspaceId: "file_home_user_projectA",
    });
    mockGetInstances.mockResolvedValue([scopedLS]);
    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c-other": {
          summary: "Other project",
          stepCount: 9,
          lastModifiedTime: "2026-06-01T00:00:00.000Z",
          workspaces: [{ workspaceFolderAbsoluteUri: "file:///home/user/projectB" }],
        },
      },
    });

    const res = await app().request("/api/conversations");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.trajectorySummaries).toEqual({});
  });

  it("normalizes workspaces from trajectoryMetadata for frontend consumers", async () => {
    const hubLS = makeInstance({ pid: 3, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);
    mockRpcCall.mockResolvedValue({
      trajectorySummaries: {
        "c-meta": {
          summary: "Metadata-only workspace",
          stepCount: 9,
          lastModifiedTime: "2026-06-01T00:00:00.000Z",
          trajectoryMetadata: {
            workspaces: [
              { workspaceFolderAbsoluteUri: "file:///home/user/project" },
            ],
          },
        },
      },
    });

    const res = await app().request("/api/conversations");
    const body = await res.json();

    expect(body.trajectorySummaries["c-meta"].workspaces).toEqual([
      { workspaceFolderAbsoluteUri: "file:///home/user/project" },
    ]);
  });

  it("scans the conversation directory for the running Antigravity app data dir", async () => {
    const ideLS = makeInstance({ pid: 33, appDataDir: "antigravity-ide" });
    mockGetInstances.mockResolvedValue([ideLS]);
    mockRpcCall.mockResolvedValue({ trajectorySummaries: {} });

    const res = await app().request("/api/conversations");

    expect(res.status).toBe(200);
    const [[dirs]] = mockScanDiskConversations.mock.calls;
    expect(Array.isArray(dirs) ? dirs[0].replace(/\\/g, "/") : "").toMatch(
      /\/\.gemini\/antigravity-ide\/conversations$/,
    );
  });

  it("learns affinity before filtering inactive scoped workspace summaries", async () => {
    const scopedLS = makeInstance({
      pid: 4,
      workspaceId: "file_home_user_active",
    });
    mockGetInstances.mockResolvedValue([scopedLS]);
    mockScanDiskConversations.mockResolvedValue([
      { id: "c-inactive", mtime: "2026-06-01T00:00:00.000Z" },
    ]);
    mockRpcCall.mockImplementation(async (method) => {
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            "c-inactive": {
              summary: "Inactive workspace",
              stepCount: 9,
              lastModifiedTime: "2026-06-01T00:00:00.000Z",
              workspaces: [
                { workspaceFolderAbsoluteUri: "file:///home/user/inactive" },
              ],
            },
          },
        };
      }
      return { steps: [] };
    });

    const res = await app().request("/api/conversations");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(conversationAffinity.get("c-inactive")).toBe(
      "file_home_user_inactive",
    );
    expect(body.trajectorySummaries["c-inactive"]).toMatchObject({
      _diskOnly: true,
      workspaces: [
        { workspaceFolderAbsoluteUri: "file:///home/user/inactive" },
      ],
    });
  });
});

describe("POST /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationAffinity.clear();
    conversationInstanceAffinity.clear();
    mockScanDiskConversations.mockResolvedValue([]);
  });

  it("sets the Antigravity 2.x required trajectory source and caches unscoped hub ownership", async () => {
    const hubLS = makeInstance({ pid: 4, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);
    mockRpcCall.mockResolvedValue({ cascadeId: "new-cascade" });

    const res = await app().request("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceFolderAbsoluteUri: "file:///home/user/project",
        fileAccessGranted: true,
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.cascadeId).toBe("new-cascade");
    expect(mockRpcCall).toHaveBeenCalledWith(
      "StartCascade",
      expect.objectContaining({
        source: "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
        workspaceFolderAbsoluteUri: "file:///home/user/project",
        workspaceUris: ["file:///home/user/project"],
      }),
      hubLS,
    );
    expect(conversationAffinity.get("new-cascade")).toBe(
      "file_home_user_project",
    );
    expect(conversationInstanceAffinity.get("new-cascade")).toBe(hubLS);
  });

  it("accepts latest Antigravity workspaceUris requests", async () => {
    const hubLS = makeInstance({ pid: 5, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);
    mockRpcCall.mockResolvedValue({ cascadeId: "new-cascade" });

    const res = await app().request("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceUris: ["file:///home/user/project"],
      }),
    });

    expect(res.status).toBe(201);
    expect(mockRpcCall).toHaveBeenCalledWith(
      "StartCascade",
      expect.objectContaining({
        workspaceFolderAbsoluteUri: "file:///home/user/project",
        workspaceUris: ["file:///home/user/project"],
      }),
      hubLS,
    );
    expect(conversationAffinity.get("new-cascade")).toBe(
      "file_home_user_project",
    );
  });

  it("infers a single known workspace when creating without workspace metadata", async () => {
    const hubLS = makeInstance({ pid: 6, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);
    mockRpcCall.mockImplementation(async (method) => {
      if (method === "GetWorkspaceInfos") return { workspaceInfos: [] };
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            existing: {
              trajectoryMetadata: {
                workspaces: [
                  { workspaceFolderAbsoluteUri: "file:///home/user/project" },
                ],
              },
            },
          },
        };
      }
      return { cascadeId: "new-cascade" };
    });

    const res = await app().request("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileAccessGranted: true }),
    });

    expect(res.status).toBe(201);
    expect(mockRpcCall).toHaveBeenCalledWith(
      "StartCascade",
      expect.objectContaining({
        workspaceFolderAbsoluteUri: "file:///home/user/project",
        workspaceUris: ["file:///home/user/project"],
      }),
      hubLS,
    );
  });
});

describe("GET /api/conversations/:id/steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conversationAffinity.clear();
    conversationInstanceAffinity.clear();
    mockScanDiskConversations.mockResolvedValue([]);
  });

  it("caps limit to MAX_STEPS_LIMIT", async () => {
    mockRpcForConversation.mockImplementation(async (method, _id, body) => {
      if (method === "GetCascadeTrajectorySteps") {
        return {
          steps: Array.from({ length: 200 }, (_, i) => ({
            id: body.stepOffset + i,
          })),
        };
      }
      return {};
    });

    const res = await app().request("/api/conversations/c-1/steps?limit=999");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.steps).toHaveLength(500);
    expect(mockRpcForConversation).toHaveBeenCalledTimes(3);
  });

  it("caps oversized tail to MAX_STEPS_LIMIT", async () => {
    const hubLS = makeInstance({ pid: 10 });
    mockRpcForConversation.mockImplementation(async (method, _id, body) => {
      if (method === "GetCascadeTrajectorySteps") {
        return {
          steps: Array.from({ length: 200 }, (_, i) => ({
            id: body.stepOffset + i,
          })),
        };
      }
      return {};
    });
    mockGetStepCount.mockResolvedValue({ count: 2000, instance: hubLS });

    const res = await app().request("/api/conversations/c-1/steps?tail=99999");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.offset).toBe(1500);
    expect(body.steps).toHaveLength(500);

    expect(mockRpcForConversation).toHaveBeenCalledWith(
      "GetCascadeTrajectorySteps",
      "c-1",
      expect.objectContaining({ stepOffset: 1500 }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("handles invalid tail gracefully", async () => {
    const hubLS = makeInstance({ pid: 10 });
    mockRpcForConversation.mockImplementation(async (method) => {
      if (method === "GetCascadeTrajectorySteps") {
        return { steps: [] };
      }
      return {};
    });
    mockGetStepCount.mockResolvedValue({ count: 2000, instance: hubLS });

    const res = await app().request("/api/conversations/c-1/steps?tail=-50");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.offset).toBe(1900);
    expect(body.steps).toHaveLength(0);

    expect(mockRpcForConversation).toHaveBeenCalledWith(
      "GetCascadeTrajectorySteps",
      "c-1",
      expect.objectContaining({ stepOffset: 1900 }),
      expect.anything(),
      expect.anything(),
    );
  });

  it("caps oversized-step placeholders before allocating them", async () => {
    mockRpcForConversation.mockRejectedValue(
      new RPCError("step at offset 999999 larger than 4194304 byte limit", "internal"),
    );

    const res = await app().request("/api/conversations/c-1/steps?limit=20");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.steps).toHaveLength(20);
  });

  it("caps invalid UTF-8 placeholders before allocating them", async () => {
    const hubLS = makeInstance({ pid: 10 });
    mockGetStepCount.mockResolvedValue({ count: 999999, instance: hubLS });
    mockRpcForConversation.mockRejectedValue(
      new RPCError("invalid UTF-8 in step data", "internal"),
    );

    const res = await app().request("/api/conversations/c-1/steps?limit=20");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.steps).toHaveLength(20);
  });
});
