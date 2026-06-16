import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { LSInstance } from "../discovery.js";
import { LSDiscovery, probeConnectRpcPort } from "../discovery.js";

function makeInstance(overrides: Partial<LSInstance> = {}): LSInstance {
  return {
    pid: 1234,
    httpsPort: 19222,
    httpPort: 19223,
    lspPort: 19224,
    csrfToken: "test-token",
    source: "daemon",
    ...overrides,
  };
}

class TestableDiscovery extends LSDiscovery {
  constructor(
    private readonly mockDiscover: () => Promise<LSInstance[]>,
    ttlMs = 10_000,
  ) {
    super(ttlMs);
  }

  protected override async discover(): Promise<LSInstance[]> {
    return this.mockDiscover();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function listenWithStatus(statusCode: number): Promise<{
  server: Server;
  port: number;
}> {
  const server = createServer((_req, res) => {
    res.statusCode = statusCode;
    res.end("{}");
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

describe("LSDiscovery caching and lookup", () => {
  let mockDiscover: ReturnType<typeof vi.fn<() => Promise<LSInstance[]>>>;

  beforeEach(() => {
    mockDiscover = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls discover on first getInstances", async () => {
    const inst = makeInstance();
    mockDiscover.mockResolvedValue([inst]);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    const result = await discovery.getInstances();

    expect(result).toEqual([inst]);
    expect(mockDiscover).toHaveBeenCalledTimes(1);
  });

  it("caches results within TTL", async () => {
    mockDiscover.mockResolvedValue([makeInstance()]);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    await discovery.getInstances();
    await discovery.getInstances();

    expect(mockDiscover).toHaveBeenCalledTimes(1);
  });

  it("re-discovers after TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const inst1 = makeInstance({ pid: 1 });
      const inst2 = makeInstance({ pid: 2 });
      mockDiscover.mockResolvedValueOnce([inst1]).mockResolvedValueOnce([inst2]);

      const discovery = new TestableDiscovery(mockDiscover, 100);
      const first = await discovery.getInstances();
      expect(first).toEqual([inst1]);

      vi.advanceTimersByTime(101);

      const second = await discovery.getInstances();
      expect(second).toEqual([inst2]);
      expect(mockDiscover).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-discovers on forceRefresh", async () => {
    mockDiscover.mockResolvedValue([makeInstance()]);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    await discovery.getInstances();
    await discovery.getInstances(true);

    expect(mockDiscover).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight discovery across concurrent callers", async () => {
    const pending = deferred<LSInstance[]>();
    const inst = makeInstance();
    mockDiscover.mockReturnValue(pending.promise);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    const first = discovery.getInstances();
    const second = discovery.getInstances();

    expect(mockDiscover).toHaveBeenCalledTimes(1);

    pending.resolve([inst]);

    await expect(first).resolves.toEqual([inst]);
    await expect(second).resolves.toEqual([inst]);
  });

  it("invalidate causes next getInstances to re-discover", async () => {
    mockDiscover.mockResolvedValue([makeInstance()]);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    await discovery.getInstances();
    discovery.invalidate();
    await discovery.getInstances();

    expect(mockDiscover).toHaveBeenCalledTimes(2);
  });

  it("does not let invalidated in-flight discoveries overwrite newer results", async () => {
    const firstPending = deferred<LSInstance[]>();
    const secondPending = deferred<LSInstance[]>();
    const inst1 = makeInstance({ pid: 1 });
    const inst2 = makeInstance({ pid: 2 });
    mockDiscover
      .mockReturnValueOnce(firstPending.promise)
      .mockReturnValueOnce(secondPending.promise);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    const first = discovery.getInstances();
    discovery.invalidate();
    const second = discovery.getInstances();

    expect(mockDiscover).toHaveBeenCalledTimes(2);

    firstPending.resolve([inst1]);
    secondPending.resolve([inst2]);

    await expect(first).resolves.toEqual([inst1]);
    await expect(second).resolves.toEqual([inst2]);
    await expect(discovery.getInstances()).resolves.toEqual([inst2]);
    expect(mockDiscover).toHaveBeenCalledTimes(2);
  });

  it("returns empty array when no instances found", async () => {
    mockDiscover.mockResolvedValue([]);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    const result = await discovery.getInstances();

    expect(result).toEqual([]);
  });

  it("returns first instance when no workspaceId specified", async () => {
    const a = makeInstance({ workspaceId: "ws_a" });
    const b = makeInstance({ workspaceId: "ws_b" });
    mockDiscover.mockResolvedValue([a, b]);

    const discovery = new TestableDiscovery(mockDiscover);
    const result = await discovery.getInstance();

    expect(result).toEqual(a);
  });

  it("returns matching instance by workspaceId", async () => {
    const a = makeInstance({ workspaceId: "ws_a" });
    const b = makeInstance({ workspaceId: "ws_b" });
    mockDiscover.mockResolvedValue([a, b]);

    const discovery = new TestableDiscovery(mockDiscover);
    await expect(discovery.getInstance("ws_b")).resolves.toEqual(b);
  });

  it("returns null when workspaceId not found", async () => {
    mockDiscover.mockResolvedValue([makeInstance({ workspaceId: "ws_a" })]);

    const discovery = new TestableDiscovery(mockDiscover);
    await expect(discovery.getInstance("ws_unknown")).resolves.toBeNull();
  });

  it("returns null when no instances available", async () => {
    mockDiscover.mockResolvedValue([]);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    await expect(discovery.getInstance()).resolves.toBeNull();
  });

  it("multiple getInstance calls share the same cache", async () => {
    const a = makeInstance({ workspaceId: "ws_a" });
    const b = makeInstance({ workspaceId: "ws_b" });
    mockDiscover.mockResolvedValue([a, b]);

    const discovery = new TestableDiscovery(mockDiscover, 60_000);
    await discovery.getInstance("ws_a");
    await discovery.getInstance("ws_b");
    await discovery.getInstance();

    expect(mockDiscover).toHaveBeenCalledTimes(1);
  });
});

describe("probeConnectRpcPort", () => {
  it("skips non-200 responses when discovering the RPC port", async () => {
    const notRpc = await listenWithStatus(404);
    const rpc = await listenWithStatus(200);

    try {
      await expect(
        probeConnectRpcPort([notRpc.port, rpc.port], "test-token"),
      ).resolves.toBe(rpc.port);
    } finally {
      await closeServer(notRpc.server);
      await closeServer(rpc.server);
    }
  });
});
