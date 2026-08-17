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

const logsDir = ensureLogsDir();
const runners = [
  spawnLoggedProcess(
    "proxy",
    commandName("pnpm"),
    ["--filter", "@porta/proxy", "start"],
    path.join(logsDir, "proxy.log"),
    {
      NODE_ENV: "production",
      PORTA_HOST: process.env.PORTA_HOST || "127.0.0.1",
      PORTA_PORT: process.env.PORTA_PORT || "3170",
    }
  ),
  spawnLoggedProcess(
    "web",
    commandName("pnpm"),
    ["--filter", "@porta/web", "preview"],
    path.join(logsDir, "web.log"),
    {
      NODE_ENV: "production",
      PORTA_HOST: process.env.PORTA_HOST || "127.0.0.1",
      PORTA_PORT: process.env.PORTA_PORT || "3170",
      PORTA_WEB_PORT: process.env.PORTA_WEB_PORT || "5173",
    }
  ),
];

console.log(
  `✓ Porta production running - proxy on :${process.env.PORTA_PORT || "3170"}, web on :${process.env.PORTA_WEB_PORT || "5173"}`,
);

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
  const label = firstExit.index === 0 ? "proxy" : "web";
  const code = typeof firstExit.code === "number" ? firstExit.code : 1;
  console.error(`${label} exited early`);
  await shutdown(code);
}
