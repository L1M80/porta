import { spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { EOL } from "node:os";
import path from "node:path";

export const isWindows = process.platform === "win32";

export function commandName(base) {
  return isWindows ? `${base}.cmd` : base;
}

export function ensureLogsDir() {
  const dir = path.resolve("logs");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stripInlineComment(value) {
  let quote = null;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "\\" && quote === '"') {
      index += 1;
      continue;
    }

    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }

    if (
      char === "#" &&
      !quote &&
      (index === 0 || /\s/.test(value[index - 1]))
    ) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value;
}

export function loadEnvFile(filePath = ".env") {
  const absPath = path.resolve(filePath);
  if (!existsSync(absPath)) return;

  const contents = readFileSync(absPath, "utf-8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator < 1) continue;

    const key = line.slice(0, separator).trim();
    const value = unquote(stripInlineComment(line.slice(separator + 1).trim()));

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function spawnLoggedProcess(
  label,
  command,
  args,
  logFile,
  extraEnv = {},
) {
  const shellCmd = [command, ...args].join(" ");
  const child = spawn(shellCmd, [], {
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: true,
  });
  const logStream = createWriteStream(logFile, { flags: "a" });

  if (child.stdout) {
    child.stdout.pipe(logStream);
  }
  if (child.stderr) {
    child.stderr.pipe(logStream);
  }

  child.on("error", (err) => {
    logStream.write(`[${label}] failed to start: ${err.message}${EOL}`);
  });

  return { child, logStream };
}

export async function terminateChild(child) {
  if (!child.pid || child.exitCode !== null) return;

  if (isWindows) {
    await new Promise((resolve) => {
      const killer = spawn(`taskkill /pid ${child.pid} /t /f`, [], {
        stdio: "ignore",
        windowsHide: true,
        shell: true,
      });
      killer.on("error", resolve);
      killer.on("exit", resolve);
    });
    return;
  }

  child.kill("SIGTERM");
}

export function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}
