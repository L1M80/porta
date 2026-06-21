import path from "node:path";
import {
  commandName,
  ensureLogsDir,
  loadEnvFile,
  spawnLoggedProcess,
  terminateChild,
  waitForExit,
} from "./common.mjs";

loadEnvFile();

const tunnelName = process.env.PORTA_TUNNEL_NAME;
if (!tunnelName) {
  console.error("PORTA_TUNNEL_NAME is required in .env or the environment");
  process.exit(1);
}
const cloudflaredConfig = process.env.PORTA_CLOUDFLARED_CONFIG;
const cloudflaredArgs = [
  ...(cloudflaredConfig ? ["--config", cloudflaredConfig] : []),
  "tunnel",
  "run",
  tunnelName,
];

const logsDir = ensureLogsDir();
const runners = [
  spawnLoggedProcess(
    "proxy",
    commandName("pnpm"),
    ["--filter", "@porta/proxy", "dev"],
    path.join(logsDir, "proxy.log"),
  ),
  spawnLoggedProcess(
    "tunnel",
    "cloudflared",
    cloudflaredArgs,
    path.join(logsDir, "tunnel.log"),
  ),
];

console.log("✓ Porta cloud - tail logs/proxy.log and logs/tunnel.log");

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  await Promise.all(runners.map(({ child }) => terminateChild(child)));
  await Promise.all(runners.map(({ logStream }) => new Promise((resolve) => {
    logStream.end(resolve);
  })));
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown(0);
  });
}

const exits = runners.map(async ({ child }, index) => ({
  index,
  ...(await waitForExit(child)),
}));

const firstExit = await Promise.race(exits);
if (!shuttingDown) {
  const label = firstExit.index === 0 ? "proxy" : "tunnel";
  const code = typeof firstExit.code === "number" ? firstExit.code : 1;
  console.error(`${label} exited early`);
  await shutdown(code);
}
