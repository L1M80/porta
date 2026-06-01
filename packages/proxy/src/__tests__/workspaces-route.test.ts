import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LSInstance } from "../discovery.js";

const mockGetInstances = vi.fn<() => Promise<LSInstance[]>>();
const mockRpcCall = vi.fn<
  (method: string, body: unknown, inst: LSInstance) => Promise<unknown>
>();

vi.mock("../routing.js", () => ({
  discovery: { getInstances: mockGetInstances },
  rpc: { call: mockRpcCall },
}));

const { registerWorkspaceRoutes } = await import("../routes/workspaces.js");

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
  registerWorkspaceRoutes(hono);
  return hono;
}

describe("GET /api/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to conversation metadata when GetWorkspaceInfos has no workspaceInfos", async () => {
    const hubLS = makeInstance({ pid: 1, workspaceId: undefined });
    mockGetInstances.mockResolvedValue([hubLS]);
    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetWorkspaceInfos") {
        return {
          homeDirPath: "C:/Users/deepk",
          homeDirUri: "file:///C:/Users/deepk",
          geminiDirUri: "file:///C:/Users/deepk/.gemini",
        };
      }
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            "c-hub": {
              workspaces: [
                {
                  workspaceFolderAbsoluteUri: "file:///C:/Users/deepk/porta",
                  gitRootAbsoluteUri: "file:///C:/Users/deepk/porta",
                },
              ],
            },
          },
        };
      }
      return {};
    });

    const res = await app().request("/api/workspaces");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workspaceInfos).toEqual([
      {
        workspaceUri: "file:///C:/Users/deepk/porta",
        gitRootUri: "file:///C:/Users/deepk/porta",
      },
    ]);
  });

  it("keeps GetWorkspaceInfos results and deduplicates conversation fallback workspaces", async () => {
    const ls = makeInstance({ pid: 2, workspaceId: "file_home_user_porta" });
    mockGetInstances.mockResolvedValue([ls]);
    mockRpcCall.mockImplementation(async (method: string) => {
      if (method === "GetWorkspaceInfos") {
        return {
          workspaceInfos: [
            {
              workspaceUri: "file:///home/user/porta",
              gitRootUri: "file:///home/user/porta",
            },
          ],
        };
      }
      if (method === "GetAllCascadeTrajectories") {
        return {
          trajectorySummaries: {
            "c1": {
              workspaces: [
                {
                  workspaceFolderAbsoluteUri: "file:///home/user/porta",
                  gitRootAbsoluteUri: "file:///home/user/porta",
                },
              ],
            },
          },
        };
      }
      return {};
    });

    const res = await app().request("/api/workspaces");
    const body = await res.json();

    expect(body.workspaceInfos).toHaveLength(1);
    expect(body.workspaceInfos[0].workspaceUri).toBe("file:///home/user/porta");
  });
});
