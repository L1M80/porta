/**
 * Language Server Discovery
 *
 * Finds running Antigravity Language Server instances by:
 * 1. Reading daemon discovery files (~/.gemini/antigravity/daemon/ls_*.json)
 * 2. Scanning OS processes for language_server executables
 * 3. Merging results from both sources (deduped by PID)
 * 4. Enriching instances with workspaceId via GetWorkspaceInfos RPC
 *
 * Each LS instance is workspace-scoped, so there may be multiple.
 */

import { readdir, readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import { platformAdapter } from "./platform/index.js";
import {
  getTransportOrder,
  rememberSuccessfulTransport,
  type TransportProtocol,
} from "./transport-hints.js";

export interface LSInstance {
  pid: number;
  httpsPort: number;
  httpPort: number;
  lspPort: number;
  csrfToken: string;
  workspaceId?: string;
  /** Derived from discovery source */
  source: "daemon" | "process";
}

const DAEMON_DIR = join(homedir(), ".gemini", "antigravity", "daemon");
const SERVICE_PREFIX = "exa.language_server_pb.LanguageServerService";

async function discoverFromDaemon(): Promise<LSInstance[]> {
  const instances: LSInstance[] = [];

  try {
    const files = await readdir(DAEMON_DIR);
    const lsFiles = files.filter(
      (file) => file.startsWith("ls_") && file.endsWith(".json"),
    );

    for (const file of lsFiles) {
      try {
        const raw = await readFile(join(DAEMON_DIR, file), "utf-8");
        const data = JSON.parse(raw);

        if (!data.pid || !data.httpsPort || !data.csrfToken) continue;
        if (!(await platformAdapter.isPidAlive(data.pid))) continue;

        instances.push({
          pid: data.pid,
          httpsPort: data.httpsPort,
          httpPort: data.httpPort ?? 0,
          lspPort: data.lspPort ?? 0,
          csrfToken: data.csrfToken,
          source: "daemon",
        });
      } catch {
        // Skip malformed files
      }
    }
  } catch {
    // Daemon dir missing or unreadable
  }

  return instances;
}

async function discoverFromProcess(): Promise<LSInstance[]> {
  const instances: LSInstance[] = [];

  try {
    const candidates = await platformAdapter.discoverFromProcess();
    const pendingInstances: Array<{
      pid: number;
      csrfToken: string;
      workspaceId?: string;
      httpsPort: number;
      httpPort: number;
      lspPort: number;
    }> = [];

    for (const candidate of candidates) {
      if (!(await platformAdapter.isPidAlive(candidate.pid))) continue;

      if (candidate.httpsPort) {
        instances.push({
          pid: candidate.pid,
          httpsPort: candidate.httpsPort,
          httpPort: candidate.httpPort,
          lspPort: candidate.lspPort,
          csrfToken: candidate.csrfToken,
          workspaceId: candidate.workspaceId,
          source: "process",
        });
      } else {
        pendingInstances.push({
          pid: candidate.pid,
          csrfToken: candidate.csrfToken,
          workspaceId: candidate.workspaceId,
          httpsPort: 0,
          httpPort: candidate.httpPort,
          lspPort: candidate.lspPort,
        });
      }
    }

    if (pendingInstances.length > 0) {
      await Promise.allSettled(
        pendingInstances.map(async (pending) => {
          const allPorts = await platformAdapter.discoverPortsForPid(pending.pid);
          const knownPorts = new Set<number>();
          if (pending.httpPort) knownPorts.add(pending.httpPort);
          if (pending.lspPort) knownPorts.add(pending.lspPort);
          const candidates = allPorts.filter((port) => !knownPorts.has(port));

          const rpcPort = await probeConnectRpcPort(
            candidates.length > 0 ? candidates : allPorts,
            pending.csrfToken,
          );

          instances.push({
            pid: pending.pid,
            httpsPort: rpcPort,
            httpPort: pending.httpPort,
            lspPort: pending.lspPort,
            csrfToken: pending.csrfToken,
            workspaceId: pending.workspaceId,
            source: "process",
          });
        }),
      );
    }
  } catch {
    // No matching processes
  }

  return instances;
}

/**
 * Probe candidate ports to find the one serving Connect RPC.
 * Tries the last successful transport first, with a short timeout.
 * Returns the first port that responds to GetWorkspaceInfos, or
 * falls back to the first candidate if none respond.
 */
async function probeConnectRpcPort(
  candidates: number[],
  csrfToken: string,
): Promise<number> {
  if (candidates.length === 0) return 0;
  if (candidates.length === 1) return candidates[0];

  const attemptProbe = (
    port: number,
    protocol: TransportProtocol,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      const payload = JSON.stringify({});
      const requestFn = protocol === "https" ? httpsRequest : httpRequest;
      const opts = {
        hostname: "127.0.0.1",
        port,
        path: `/${SERVICE_PREFIX}/GetWorkspaceInfos`,
        method: "POST" as const,
        headers: {
          "Content-Type": "application/json",
          "x-codeium-csrf-token": csrfToken,
          "Content-Length": Buffer.byteLength(payload),
        },
        ...(protocol === "https" ? { rejectUnauthorized: false } : {}),
      };

      const req = requestFn(opts, (res) => {
        res.on("data", () => {});
        res.on("end", () => {
          resolve(
            res.statusCode !== undefined &&
              res.statusCode >= 200 &&
              res.statusCode < 500,
          );
        });
      });

      req.on("error", () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
      req.write(payload);
      req.end();
    });

  const probe = async (port: number): Promise<boolean> => {
    const target = { httpsPort: port, csrfToken };
    for (const protocol of getTransportOrder(target)) {
      if (await attemptProbe(port, protocol)) {
        rememberSuccessfulTransport(target, protocol);
        return true;
      }
    }
    return false;
  };

  const results = await Promise.all(
    candidates.map(async (port) => ({ port, ok: await probe(port) })),
  );
  const found = results.find((result) => result.ok);
  return found?.port ?? candidates[0];
}

/** Convert a workspace URI to the LS workspaceId format. */
function uriToWorkspaceId(uri: string): string {
  return uri.replace(/^file:\/\/\//, "file_").replace(/\//g, "_");
}

/**
 * Query an LS instance's GetWorkspaceInfos endpoint to resolve its workspaceId.
 * Uses raw HTTP/HTTPS to avoid a circular dependency on RPCClient.
 */
async function queryWorkspaceInfo(
  inst: LSInstance,
): Promise<{ reachable: boolean; workspaceId?: string }> {
  const doPost = (
    protocol: TransportProtocol,
  ): Promise<{ reachable: boolean; workspaceId?: string } | undefined> =>
    new Promise((resolve) => {
      const payload = JSON.stringify({});
      const requestFn = protocol === "https" ? httpsRequest : httpRequest;
      const opts = {
        hostname: "127.0.0.1",
        port: inst.httpsPort,
        path: `/${SERVICE_PREFIX}/GetWorkspaceInfos`,
        method: "POST" as const,
        headers: {
          "Content-Type": "application/json",
          "x-codeium-csrf-token": inst.csrfToken,
          "Content-Length": Buffer.byteLength(payload),
        },
        ...(protocol === "https" ? { rejectUnauthorized: false } : {}),
      };

      const req = requestFn(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            const wsUri = data.workspaceInfos?.[0]?.workspaceUri as
              | string
              | undefined;
            resolve({
              reachable: true,
              workspaceId: wsUri ? uriToWorkspaceId(wsUri) : undefined,
            });
          } catch {
            resolve({ reachable: true });
          }
        });
      });

      req.on("error", () => resolve(undefined));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(undefined);
      });
      req.write(payload);
      req.end();
    });

  for (const protocol of getTransportOrder(inst)) {
    const result = await doPost(protocol);
    if (result !== undefined) {
      rememberSuccessfulTransport(inst, protocol);
      return result;
    }
  }

  return { reachable: false };
}

/**
 * Enrich instances that lack workspaceId by querying the LS directly.
 * This is the authoritative resolution when daemon or process metadata
 * is incomplete or stale.
 */
async function enrichReachableInstances(
  instances: LSInstance[],
): Promise<LSInstance[]> {
  const results = await Promise.all(
    instances.map(async (inst) => {
      const info = await queryWorkspaceInfo(inst);
      if (!info.reachable) return null;
      if (info.workspaceId) inst.workspaceId = info.workspaceId;
      return inst;
    }),
  );

  return results.filter((inst): inst is LSInstance => inst !== null);
}

/**
 * Discover all running Language Server instances.
 *
 * Resolution order:
 * 1. Daemon files
 * 2. Process discovery
 * 3. RPC enrichment
 */
export async function discoverInstances(): Promise<LSInstance[]> {
  const daemonInstances = await discoverFromDaemon();
  const processInstances = await discoverFromProcess();

  const instanceMap = new Map<number, LSInstance>();

  for (const daemonInstance of daemonInstances) {
    if (daemonInstance.pid && !Number.isNaN(daemonInstance.pid)) {
      instanceMap.set(daemonInstance.pid, daemonInstance);
    }
  }

  for (const processInstance of processInstances) {
    const existing = instanceMap.get(processInstance.pid);
    if (existing) {
      existing.httpsPort = existing.httpsPort || processInstance.httpsPort;
      existing.httpPort = existing.httpPort || processInstance.httpPort;
      existing.lspPort = existing.lspPort || processInstance.lspPort;
      existing.csrfToken = existing.csrfToken || processInstance.csrfToken;
      if (!existing.workspaceId && processInstance.workspaceId) {
        existing.workspaceId = processInstance.workspaceId;
      }
    } else {
      instanceMap.set(processInstance.pid, processInstance);
    }
  }

  const instances = Array.from(instanceMap.values());
  return enrichReachableInstances(instances);
}

/**
 * Cached discovery with auto-refresh on error.
 */
export class LSDiscovery {
  private instances: LSInstance[] = [];
  private lastDiscovery = 0;
  private readonly ttlMs: number;
  private pendingDiscovery: Promise<LSInstance[]> | null = null;
  private discoveryGeneration = 0;

  constructor(ttlMs = 10_000) {
    this.ttlMs = ttlMs;
  }

  protected async discover(): Promise<LSInstance[]> {
    return discoverInstances();
  }

  async getInstances(forceRefresh = false): Promise<LSInstance[]> {
    const now = Date.now();
    const cacheFresh =
      !forceRefresh &&
      this.instances.length > 0 &&
      now - this.lastDiscovery <= this.ttlMs;

    if (cacheFresh) {
      return this.instances;
    }

    if (!forceRefresh && this.pendingDiscovery) {
      return this.pendingDiscovery;
    }

    const generation = ++this.discoveryGeneration;
    const pending = this.discover()
      .then((instances) => {
        if (generation === this.discoveryGeneration) {
          this.instances = instances;
          this.lastDiscovery = Date.now();
        }
        return instances;
      })
      .finally(() => {
        if (this.pendingDiscovery === pending) {
          this.pendingDiscovery = null;
        }
      });

    this.pendingDiscovery = pending;
    return pending;
  }

  /**
   * Get the first available instance (or a specific workspace).
   */
  async getInstance(workspaceId?: string): Promise<LSInstance | null> {
    const instances = await this.getInstances();

    if (workspaceId) {
      return instances.find((inst) => inst.workspaceId === workspaceId) ?? null;
    }

    return instances[0] ?? null;
  }

  /** Force re-discovery (e.g. on connection error). */
  invalidate(): void {
    this.discoveryGeneration++;
    this.lastDiscovery = 0;
    this.pendingDiscovery = null;
  }
}
