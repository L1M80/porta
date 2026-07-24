import {
  isLanguageServerExecutable,
  parseNetstatPorts,
  parseWin32ProcessCandidates,
  runCommand,
} from "./shared.js";
import type { PlatformAdapter } from "./types.js";

const POWERSHELL = "powershell.exe";
const PROCESS_DISCOVERY_TIMEOUT_MS = 10_000;
const PORT_DISCOVERY_TIMEOUT_MS = 15_000;
const DISCOVER_PROCESS_COMMAND =
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'language_server*' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress";

export const win32Adapter: PlatformAdapter = {
  id: "win32",

  async isPidAlive(pid) {
    try {
      const output = await runCommand(POWERSHELL, [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object Name | ConvertTo-Json -Compress`,
      ]);
      const trimmed = output.trim();
      if (!trimmed) return false;

      const parsed = JSON.parse(trimmed) as
        | { Name?: string | null }
        | { Name?: string | null }[]
        | null;
      const record = Array.isArray(parsed) ? parsed[0] : parsed;
      return typeof record?.Name === "string" && isLanguageServerExecutable(record.Name);
    } catch {
      return false;
    }
  },

  async discoverFromProcess() {
    try {
      const output = await runCommand(POWERSHELL, [
        "-NoProfile",
        "-Command",
        DISCOVER_PROCESS_COMMAND,
      ], PROCESS_DISCOVERY_TIMEOUT_MS);
      return parseWin32ProcessCandidates(output);
    } catch {
      return [];
    }
  },

  async discoverPortsForPid(pid) {
    try {
      const output = await runCommand(
        "netstat",
        ["-ano"],
        PORT_DISCOVERY_TIMEOUT_MS,
      );
      return parseNetstatPorts(output, pid);
    } catch {
      return [];
    }
  },
};
