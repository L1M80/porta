import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hasAliveSignal,
  parsePsCandidates,
  parseSsPorts,
  runCommand,
} from "./shared.js";
import type { PlatformAdapter } from "./types.js";

const isDocker = existsSync("/.dockerenv");

export const linuxAdapter: PlatformAdapter = {
  id: "linux",

  async isPidAlive(pid) {
    if (isDocker) {
      // Inside a Docker container, we cannot inspect host processes.
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
