import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  commandName,
  ensureLogsDir,
  isWindows,
  loadEnvFile,
  spawnLoggedProcess,
  terminateChild,
  waitForExit,
} from "./common.mjs";

loadEnvFile();

let tailscaleIp;
try {
  tailscaleIp = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" })
    .trim()
    .split("\n")[0]
    .trim();
} catch {
  console.error(
    "Error: Could not run `tailscale ip -4`. Make sure Tailscale is installed and connected.",
  );
  process.exit(1);
}

if (!tailscaleIp || !/^\d{1,3}(\.\d{1,3}){3}$/.test(tailscaleIp)) {
  console.error(`Error: Unexpected output from \`tailscale ip -4\`: "${tailscaleIp}".`);
  process.exit(1);
}

const proxyPort = process.env.PORTA_PORT ?? "3170";
const webPort = process.env.PORTA_WEB_PORT ?? "5173";
const apiBase = `http://${tailscaleIp}:${proxyPort}`;

process.env.PORTA_HOST = tailscaleIp;
process.env.PORTA_TAILSCALE = "1";

const tailscaleOrigin = `http://${tailscaleIp}:${webPort}`;
if (process.env.PORTA_CORS_ORIGINS) {
  process.env.PORTA_CORS_ORIGINS += `,${tailscaleOrigin}`;
} else {
  process.env.PORTA_CORS_ORIGINS = tailscaleOrigin;
}

console.log(`Tailscale IP: ${tailscaleIp}`);
console.log("Building Porta once for stable serving...");

execFileSync(commandName("pnpm"), ["--filter", "@porta/proxy", "build"], {
  stdio: "inherit",
  env: process.env,
  shell: isWindows,
});
execFileSync(commandName("pnpm"), ["--filter", "@porta/web", "build"], {
  stdio: "inherit",
  env: { ...process.env, VITE_API_BASE: apiBase },
  shell: isWindows,
});

const logsDir = ensureLogsDir();
const runners = [
  spawnLoggedProcess(
    "proxy",
    commandName("pnpm"),
    ["--filter", "@porta/proxy", "start"],
    path.join(logsDir, "proxy-stable.log"),
    { env: process.env },
  ),
  spawnLoggedProcess(
    "web",
    commandName("pnpm"),
    [
      "--filter",
      "@porta/web",
      "preview",
      "--host",
      "0.0.0.0",
      "--port",
      webPort,
      "--strictPort",
    ],
    path.join(logsDir, "web-stable.log"),
    { env: process.env },
  ),
];

console.log(
  `Porta stable Tailscale Web UI: ${tailscaleOrigin}\n` +
    `Porta stable Tailscale Proxy:  ${apiBase}\n` +
    "Code changes will not reload this server. Re-run this script to rebuild.",
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
