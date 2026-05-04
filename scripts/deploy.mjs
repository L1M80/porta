import { commandName, loadEnvFile } from "./common.mjs";
import { spawn } from "node:child_process";

loadEnvFile();

const project = process.env.PORTA_CF_PROJECT;
if (!project) {
  console.error("PORTA_CF_PROJECT is required in .env or the environment");
  process.exit(1);
}

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
      ...opts,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
      }
    });
  });
}

await run(commandName("pnpm"), ["build:web"]);
await run(commandName("npx"), [
  "wrangler",
  "pages",
  "deploy",
  "./dist",
  `--project-name=${project}`,
  "--branch=main",
], { cwd: "./packages/web" });
