import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hasAliveSignal,
  parsePsCandidates,
  parseSsPorts,
  runCommand,
} from "./shared.js";
import type { PlatformAdapter } from "./types.js";

type ContainerFs = {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
};

export function isContainerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  fs: ContainerFs = { existsSync, readFileSync },
): boolean {
  if (env.PORTA_CONTAINER === "1") return true;
  if (fs.existsSync("/.dockerenv")) return true;
  if (fs.existsSync("/run/.containerenv")) return true;
  try {
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf-8");
    if (
      cgroup.includes("docker") ||
      cgroup.includes("kubepods") ||
      cgroup.includes("containerd")
    ) {
      return true;
    }
  } catch {
    // Ignore read errors
  }
  return false;
}

const isContainer = isContainerEnvironment();

export const linuxAdapter: PlatformAdapter = {
  id: "linux",

  async isPidAlive(pid) {
    if (isContainer) {
      // Inside a container, we cannot inspect host processes.
      // Assume the PID is alive and let the network probe verify it.
      return true;
    }

    if (!hasAliveSignal(pid)) return false;

    try {
      const comm = await readFile(join("/proc", String(pid), "comm"), "utf-8");
      return comm.includes("language_server");
    } catch {
      return false;
    }
  },

  async discoverFromProcess() {
    try {
      const output = await runCommand("ps", ["-axo", "pid=,args="]);
      return parsePsCandidates(output);
    } catch {
      return [];
    }
  },

  async discoverPortsForPid(pid) {
    try {
      const output = await runCommand("ss", ["-tlnp"]);
      return parseSsPorts(output, pid);
    } catch {
      return [];
    }
  },
};
