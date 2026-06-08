import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MockApiServer } from "./mockApiServer";

const API_PORT = 4170;
const WEB_PORT = 4173;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const WEB_ROOT = resolve(import.meta.dirname, "../..");
const VITE_BIN = resolve(WEB_ROOT, "node_modules/vite/bin/vite.js");

interface CdpResponse<T> {
  result: T;
  exceptionDetails?: unknown;
}

async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  throw new Error(
    `Timed out waiting for ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function stopProcess(process: ChildProcess | null) {
  if (!process || process.killed) {
    return;
  }

  process.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolveExit) => {
    const timer = setTimeout(() => {
      process.kill("SIGKILL");
    }, 5_000);
    process.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });

  if (exitCode === null) {
    process.kill("SIGKILL");
  }
}

function resolveChromeCommand() {
  const candidates = [
    globalThis.process.env.PORTA_E2E_CHROME_BIN,
    "google-chrome",
    "google-chrome-stable",
    "chromium-browser",
    "chromium",
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const result = spawnSync(candidate, ["--version"], {
      stdio: "ignore",
    });
    if (result.status === 0) {
      return candidate;
    }
  }

  throw new Error(
    "Could not find a Chrome/Chromium binary. Set PORTA_E2E_CHROME_BIN to override.",
  );
}

class CdpConnection {
  private nextId = 1;
  private readonly socket: WebSocket;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  constructor(socket: WebSocket) {
    this.socket = socket;

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
      };

      if (!message.id) {
        return;
      }

      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "CDP error"));
        return;
      }

      pending.resolve(message.result);
    });

    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("CDP socket closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(wsUrl: string) {
    const socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error(`Failed to connect to ${wsUrl}`)),
        { once: true },
      );
    });
    return new CdpConnection(socket);
  }

  async send<T>(method: string, params: Record<string, unknown>, sessionId?: string) {
    const id = this.nextId++;
    const payload = JSON.stringify({
      id,
      method,
      params,
      ...(sessionId ? { sessionId } : {}),
    });

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.socket.send(payload);
    });
  }

  close() {
    this.socket.close();
  }
}

class CdpPage {
  private readonly connection: CdpConnection;
  private readonly sessionId: string;
  private readonly targetId: string;

  constructor(
    connection: CdpConnection,
    sessionId: string,
    targetId: string,
  ) {
    this.connection = connection;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  async navigate(url: string) {
    await this.connection.send("Page.navigate", { url }, this.sessionId);
    await this.waitFor(
      "document.readyState === 'complete'",
      { timeoutMs: 15_000, description: "document to finish loading" },
    );
  }

  async waitFor(
    expression: string,
    options: { timeoutMs?: number; description?: string } = {},
  ) {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const matched = await this.evaluate<boolean>(expression);
        if (matched) {
          return;
        }
      } catch (error) {
        lastError = error;
      }
      await delay(50);
    }

    throw new Error(
      `Timed out waiting for ${options.description ?? expression}: ${
        lastError instanceof Error ? lastError.message : String(lastError ?? "")
      }`,
    );
  }

  async waitForPath(pathname: string) {
    await this.waitFor(`location.pathname === ${JSON.stringify(pathname)}`, {
      timeoutMs: 10_000,
      description: `pathname ${pathname}`,
    });
  }

  async waitForText(text: string) {
    await this.waitFor(
      `document.body?.innerText.includes(${JSON.stringify(text)})`,
      {
        timeoutMs: 10_000,
        description: `text ${text}`,
      },
    );
  }

  async fill(selector: string, value: string) {
    const filled = await this.evaluate<boolean>(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
          return false;
        }

        const prototype =
          element instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor?.set?.call(element, ${JSON.stringify(value)});
        element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        element.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return true;
      })()`,
    );

    if (!filled) {
      throw new Error(`Unable to fill ${selector}`);
    }
  }

  async click(selector: string) {
    const clicked = await this.evaluate<boolean>(
      `(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) {
          return false;
        }
        element.click();
        return true;
      })()`,
    );

    if (!clicked) {
      throw new Error(`Unable to click ${selector}`);
    }
  }

  async exists(selector: string) {
    return this.evaluate<boolean>(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    );
  }

  async grantPermissions(permissions: string[], origin: string) {
    await this.connection.send("Browser.grantPermissions", {
      permissions,
      origin,
    });
  }

  async count(selector: string) {
    return this.evaluate<number>(
      `document.querySelectorAll(${JSON.stringify(selector)}).length`,
    );
  }

  async path() {
    return this.evaluate<string>("location.pathname");
  }

  async bodyText() {
    return this.evaluate<string>("document.body?.innerText ?? ''");
  }

  async evaluate<T>(expression: string) {
    const response = await this.connection.send<CdpResponse<{ value?: T }>>(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
      },
      this.sessionId,
    );

    if (response.exceptionDetails) {
      throw new Error(`Runtime evaluation failed for: ${expression}`);
    }

    return response.result.value as T;
  }

  async close() {
    await this.connection.send("Target.closeTarget", { targetId: this.targetId });
  }
}

class ChromeHarness {
  private readonly process: ChildProcess;
  private readonly connection: CdpConnection;
  private readonly userDataDir: string;

  private constructor(
    process: ChildProcess,
    connection: CdpConnection,
    userDataDir: string,
  ) {
    this.process = process;
    this.connection = connection;
    this.userDataDir = userDataDir;
  }

  static async start() {
    const userDataDir = await mkdtemp(join(tmpdir(), "porta-e2e-chrome-"));
    const chromeCommand = resolveChromeCommand();
    const process = spawn(
      chromeCommand,
      [
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "about:blank",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const wsUrl = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timed out waiting for Chrome DevTools endpoint"));
      }, 15_000);

      const onData = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (!match) {
          return;
        }
        clearTimeout(timeout);
        process.stderr?.off("data", onData);
        resolve(match[1]);
      };

      process.stderr?.on("data", onData);
      process.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Chrome exited before startup with code ${code}`));
      });
    });

    const connection = await CdpConnection.connect(wsUrl);
    return new ChromeHarness(process, connection, userDataDir);
  }

  async newPage() {
    const { targetId } = await this.connection.send<{ targetId: string }>(
      "Target.createTarget",
      { url: "about:blank" },
    );
    const { sessionId } = await this.connection.send<{ sessionId: string }>(
      "Target.attachToTarget",
      { targetId, flatten: true },
    );
    await this.connection.send("Page.enable", {}, sessionId);
    await this.connection.send("Runtime.enable", {}, sessionId);
    return new CdpPage(this.connection, sessionId, targetId);
  }

  async stop() {
    this.connection.close();
    await stopProcess(this.process);
    await rm(this.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

class ViteHarness {
  private readonly process: ChildProcess;

  private constructor(process: ChildProcess) {
    this.process = process;
  }

  static async start() {
    const child = spawn(
      globalThis.process.execPath,
      [VITE_BIN, "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"],
      {
        cwd: WEB_ROOT,
        env: {
          ...globalThis.process.env,
          PORTA_HOST: "127.0.0.1",
          PORTA_PORT: String(API_PORT),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    await waitForHttp(`${WEB_ORIGIN}/`, 20_000);
    return new ViteHarness(child);
  }

  async stop() {
    await stopProcess(this.process);
  }
}

export class AppHarness {
  readonly api: MockApiServer;
  private readonly chrome: ChromeHarness;
  private readonly vite: ViteHarness;

  private constructor(
    api: MockApiServer,
    chrome: ChromeHarness,
    vite: ViteHarness,
  ) {
    this.api = api;
    this.chrome = chrome;
    this.vite = vite;
  }

  static async start() {
    const api = new MockApiServer(API_PORT);
    await api.start();

    let vite: ViteHarness | null = null;
    let chrome: ChromeHarness | null = null;
    try {
      [vite, chrome] = await Promise.all([
        ViteHarness.start(),
        ChromeHarness.start(),
      ]);
      return new AppHarness(api, chrome, vite);
    } catch (error) {
      await Promise.allSettled([api.stop(), vite?.stop(), chrome?.stop()]);
      throw error;
    }
  }

  url(pathname: string) {
    return new URL(pathname, `${WEB_ORIGIN}/`).toString();
  }

  async newPage() {
    return this.chrome.newPage();
  }

  async stop() {
    const results = await Promise.allSettled([
      this.chrome.stop(),
      this.vite.stop(),
      this.api.stop(),
    ]);

    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure) {
      throw failure.reason;
    }
  }
}
