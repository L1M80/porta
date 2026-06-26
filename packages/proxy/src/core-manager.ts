import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

let coreProcess: ChildProcess | null = null;
let isStarting = false;

export async function ensureStandaloneCore(): Promise<void> {
  if (process.env.PORTA_STANDALONE_CORE !== "true") {
    return;
  }

  if (coreProcess) {
    return;
  }

  if (isStarting) {
    // Wait a bit if it's already starting
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return;
  }

  isStarting = true;

  try {
    const binaryPath =
      process.env.PORTA_CORE_BINARY_PATH ||
      join(homedir(), "Antigravity-x64", "resources", "bin", "language_server");

    const csrfToken = randomUUID();
    console.log(`[Core Manager] Starting standalone Antigravity core from ${binaryPath} with csrf ${csrfToken}...`);

    coreProcess = spawn(
      binaryPath,
      [
        "--standalone",
        "--override_ide_name", "antigravity",
        "--subclient_type", "hub",
        "--override_ide_version", "2.2.1",
        "--override_user_agent_name", "antigravity",
        "--https_server_port", "0",
        "--csrf_token", csrfToken,
        "--app_data_dir", "antigravity",
        "--config_dir", "porta_config",
        "--api_server_url", "https://generativelanguage.googleapis.com",
        "--cloud_code_endpoint", "https://daily-cloudcode-pa.googleapis.com",
        "--enable_sidecars",
      ],
      {
        stdio: ["pipe", "ignore", "ignore"],
        detached: true,
      }
    );

    coreProcess.on("error", (err) => {
      console.error(`[Core Manager] Failed to start standalone core:`, err);
      coreProcess = null;
      isStarting = false;
    });

    coreProcess.on("exit", (code) => {
      console.log(`[Core Manager] Standalone core exited with code ${code}`);
      coreProcess = null;
      isStarting = false;
    });

    // Unref so it doesn't keep the proxy alive unnecessarily, though we want it to run as long as proxy runs.
    coreProcess.unref();

    // Give it a moment to initialize and write the daemon file
    await new Promise((resolve) => setTimeout(resolve, 3000));
  } finally {
    isStarting = false;
  }
}

export function stopStandaloneCore() {
  if (coreProcess) {
    console.log("[Core Manager] Stopping standalone Antigravity core...");
    coreProcess.kill("SIGTERM");
    coreProcess = null;
  }
}
