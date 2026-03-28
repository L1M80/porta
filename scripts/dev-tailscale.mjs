import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  commandName,
  ensureLogsDir,
  loadEnvFile,
  spawnLoggedProcess,
  terminateChild,
  waitForExit,
} from "./common.mjs";

loadEnvFile();

// ── Discover Tailscale IP ──

let tailscaleIp;
try {
  tailscaleIp = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" })
    .trim()
    .split("\n")[0]
    .trim();
} catch {
  console.error(
    "Error: Could not run `tailscale ip -4`. " +
      "Make sure Tailscale is installed and connected (https://tailscale.com/download).",
  );
  process.exit(1);
}

if (!tailscaleIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(tailscaleIp)) {
  console.error(
    `Error: Unexpected output from \`tailscale ip -4\`: "${tailscaleIp}". ` +
      "Ensure Tailscale is connected and has a valid IP assigned.",
  );
  process.exit(1);
}

console.log(`✓ Tailscale IP: ${tailscaleIp}`);

// ── Inject into env ──
// PORTA_HOST: binds the proxy to the Tailscale interface
// PORTA_TAILSCALE: unlocks the exposure guard for CGNAT IPs (100.64–127.x.x)
process.env.PORTA_HOST = tailscaleIp;
process.env.PORTA_TAILSCALE = "1";

const tailscaleOrigin = `http://${tailscaleIp}:5173`;
if (process.env.PORTA_CORS_ORIGINS) {
  process.env.PORTA_CORS_ORIGINS += `,${tailscaleOrigin}`;
} else {
  process.env.PORTA_CORS_ORIGINS = tailscaleOrigin;
}

// ── Spawn processes ──

const logsDir = ensureLogsDir();
const runners = [
  spawnLoggedProcess(
    "proxy",
    commandName("pnpm"),
    ["--filter", "@porta/proxy", "dev"],
    path.join(logsDir, "proxy.log"),
    { env: process.env },
  ),
  spawnLoggedProcess(
    "web",
    commandName("pnpm"),
    ["--filter", "@porta/web", "dev", "--host", "--port", "5173"],
    path.join(logsDir, "web.log"),
    { env: { ...process.env, VITE_API_BASE: `http://${tailscaleIp}:${process.env.PORTA_PORT ?? 3170}` } },
  ),
];

console.log(
  `✓ Porta Tailscale Web UI — http://${tailscaleIp}:5173\n` +
  `✓ Porta Tailscale Proxy  — http://${tailscaleIp}:${process.env.PORTA_PORT ?? 3170}\n` +
    "  Tail logs/proxy.log and logs/web.log for output.",
);

let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  await Promise.all(runners.map(({ child }) => terminateChild(child)));
  await Promise.all(
    runners.map(
      ({ logStream }) =>
        new Promise((resolve) => {
          logStream.end(resolve);
        }),
    ),
  );
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
  const label = firstExit.index === 0 ? "proxy" : "web";
  const code = typeof firstExit.code === "number" ? firstExit.code : 1;
  console.error(`${label} exited early`);
  await shutdown(code);
}
