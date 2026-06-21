import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProcessDiscoveryCandidate } from "./types.js";

const execFileAsync = promisify(execFile);
const LANGUAGE_SERVER_EXECUTABLE =
  /(?:^|[\\/])language_server(?:_[^/\\\s"']+)?(?:\.exe)?$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseExecutable(args: string): string | undefined {
  const match = args.match(/^(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s|$)/);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function isLanguageServerExecutable(value: string): boolean {
  return LANGUAGE_SERVER_EXECUTABLE.test(value.trim());
}

function parseArgValue(args: string, flag: string): string | undefined {
  const escapedFlag = escapeRegExp(flag);
  const match = args.match(
    new RegExp(
      `${escapedFlag}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|(\\S+))`,
    ),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function parsePort(args: string, flag: string): number {
  const value = parseArgValue(args, flag);
  if (!value) return 0;
  const port = parseInt(value, 10);
  return Number.isNaN(port) ? 0 : port;
}

export function hasAliveSignal(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function runCommand(
  command: string,
  args: string[],
  timeout = 5000,
): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf-8",
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

export function parseCommandCandidate(
  pid: number,
  args: string,
): ProcessDiscoveryCandidate | undefined {
  const executable = parseExecutable(args);
  if (!executable || Number.isNaN(pid) || !isLanguageServerExecutable(executable)) {
    return undefined;
  }

  const csrfToken = parseArgValue(args, "--csrf_token");
  if (!csrfToken) return undefined;
  const appDataDir = parseArgValue(args, "--app_data_dir");

  return {
    pid,
    csrfToken,
    workspaceId: parseArgValue(args, "--workspace_id"),
    ...(appDataDir ? { appDataDir } : {}),
    httpsPort: parsePort(args, "--server_port"),
    httpPort: parsePort(args, "--extension_server_port"),
    lspPort: parsePort(args, "--lsp_port"),
  };
}

export function parsePsCandidates(output: string): ProcessDiscoveryCandidate[] {
  const results: ProcessDiscoveryCandidate[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;

    const pid = parseInt(match[1], 10);
    const args = match[2];
    const candidate = parseCommandCandidate(pid, args);
    if (candidate) {
      results.push(candidate);
    }
  }

  return results;
}

type Win32ProcessRecord = {
  ProcessId?: number | string;
  CommandLine?: string | null;
  Name?: string | null;
};

export function parseWin32ProcessCandidates(
  output: string,
): ProcessDiscoveryCandidate[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  let parsed: Win32ProcessRecord | Win32ProcessRecord[] | null;
  try {
    parsed = JSON.parse(trimmed) as Win32ProcessRecord | Win32ProcessRecord[] | null;
  } catch {
    return [];
  }

  const records = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const results: ProcessDiscoveryCandidate[] = [];

  for (const record of records) {
    const pid =
      typeof record.ProcessId === "number"
        ? record.ProcessId
        : parseInt(String(record.ProcessId ?? ""), 10);
    const commandLine =
      typeof record.CommandLine === "string" ? record.CommandLine.trim() : "";
    if (!commandLine) continue;

    const candidate = parseCommandCandidate(pid, commandLine);
    if (candidate) {
      results.push(candidate);
    }
  }

  return results;
}

export function parseSsPorts(output: string, pid: number): number[] {
  const ports = new Set<number>();

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.includes(`pid=${pid},`) || !line.includes("language_server")) {
      continue;
    }

    const match = line.match(/:(\d+)\s/);
    if (!match) continue;

    const port = parseInt(match[1], 10);
    if (!Number.isNaN(port)) {
      ports.add(port);
    }
  }

  return Array.from(ports);
}

export function parseLsofPorts(output: string): number[] {
  const ports = new Set<number>();

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line || !line.includes("(LISTEN)")) continue;

    const match = line.match(/:(\d+)\s+\(LISTEN\)$/);
    if (!match) continue;

    const port = parseInt(match[1], 10);
    if (!Number.isNaN(port)) {
      ports.add(port);
    }
  }

  return Array.from(ports);
}

export function parseNetstatPorts(output: string, pid: number): number[] {
  const ports = new Set<number>();

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const columns = line.split(/\s+/);
    if (columns.length < 5) continue;

    const rowPid = parseInt(columns[columns.length - 1], 10);
    if (rowPid !== pid) continue;

    const remoteAddress = columns[2];
    const isListening =
      remoteAddress.endsWith(":0") || remoteAddress.endsWith(":*");
    if (!isListening) continue;

    const localAddress = columns[1];
    const match = localAddress.match(/:(\d+)$/);
    if (!match) continue;

    const port = parseInt(match[1], 10);
    if (!Number.isNaN(port)) {
      ports.add(port);
    }
  }

  return Array.from(ports);
}
