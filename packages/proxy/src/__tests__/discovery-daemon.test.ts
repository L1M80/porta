import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = vi.hoisted(() => ({ tempHome: "" }));
const platformMocks = vi.hoisted(() => ({
  isPidAlive: vi.fn(),
  discoverFromProcess: vi.fn(),
  discoverPortsForPid: vi.fn(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => state.tempHome,
  };
});

vi.mock("../platform/index.js", () => ({
  platformAdapter: {
    isPidAlive: platformMocks.isPidAlive,
    discoverFromProcess: platformMocks.discoverFromProcess,
    discoverPortsForPid: platformMocks.discoverPortsForPid,
  },
}));

async function listen(
  statusCode: number,
  body: string,
  contentType = "text/plain",
): Promise<{ server: Server; port: number }> {
  const server = createServer((_req, res) => {
    res.statusCode = statusCode;
    res.setHeader("content-type", contentType);
    res.end(body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return { server, port: address.port };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function writeDaemonFile(port: number): Promise<void> {
  const daemonDir = join(state.tempHome, ".gemini", "antigravity", "daemon");
  await mkdir(daemonDir, { recursive: true });
  await writeFile(
    join(daemonDir, "ls_fake.json"),
    JSON.stringify({
      pid: 999999,
      httpsPort: port,
      httpPort: 0,
      lspPort: 0,
      csrfToken: "fake-token",
    }),
  );
}

describe("daemon discovery validation", () => {
  beforeEach(async () => {
    vi.resetModules();
    state.tempHome = await mkdtemp(join(tmpdir(), "porta-discovery-"));
    platformMocks.isPidAlive.mockResolvedValue(true);
    platformMocks.discoverFromProcess.mockResolvedValue([]);
    platformMocks.discoverPortsForPid.mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(state.tempHome, { recursive: true, force: true });
    state.tempHome = "";
  });

  it("drops daemon entries whose port is not serving GetWorkspaceInfos", async () => {
    const { server, port } = await listen(404, "not an LS");
    try {
      await writeDaemonFile(port);
      const { discoverInstances } = await import("../discovery.js");

      await expect(discoverInstances()).resolves.toEqual([]);
    } finally {
      await closeServer(server);
    }
  });

  it("keeps reachable hub daemon entries without workspace folders", async () => {
    const { server, port } = await listen(
      200,
      JSON.stringify({ homeDirUri: "file:///home/user" }),
      "application/json",
    );
    try {
      await writeDaemonFile(port);
      const { discoverInstances } = await import("../discovery.js");

      await expect(discoverInstances()).resolves.toMatchObject([
        {
          pid: 999999,
          httpsPort: port,
          source: "daemon",
        },
      ]);
    } finally {
      await closeServer(server);
    }
  });
});
