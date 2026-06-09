import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppHarness } from "./fixtures/appHarness";

describe("web e2e", () => {
  let harness: AppHarness | undefined;
  let page: Awaited<ReturnType<AppHarness["newPage"]>> | null = null;

  beforeAll(async () => {
    harness = await AppHarness.start();
  });

  afterAll(async () => {
    await harness?.stop();
  });

  beforeEach(async () => {
    harness!.api.reset();
    page = await harness!.newPage();
  });

  afterEach(async () => {
    await page?.close();
    page = null;
  });

  it("redirects root to the first workspace and shows the new chat state", async () => {
    const app = harness!;

    await page!.navigate(app.url("/"));
    await page!.waitForPath("/porta");
    await page!.waitForText("Start a conversation");
    await page!.waitFor(
      `Boolean(document.querySelector('button[title="Select workspace"]'))`,
      { timeoutMs: 10_000, description: "workspace selector to appear" },
    );

    expect(await page!.path()).toBe("/porta");
    expect(await page!.exists('button[title="Select workspace"]')).toBe(true);
    expect(await page!.bodyText()).toContain("New Chat");
  });

  it("creates a conversation and renders the mocked assistant reply", async () => {
    const prompt = "Please summarize the README";
    const app = harness!;

    await page!.navigate(app.url("/"));
    await page!.waitForPath("/porta");
    await page!.waitFor(
      `(() => {
        const input = document.querySelector(".chat-input");
        return input instanceof HTMLTextAreaElement && !input.disabled;
      })()`,
      { timeoutMs: 10_000, description: "chat input to become interactive" },
    );

    await page!.fill(".chat-input", prompt);
    await page!.waitFor(
      `(() => {
        const button = document.querySelector(".chat-send-btn");
        return button instanceof HTMLButtonElement && !button.disabled;
      })()`,
      { timeoutMs: 5_000, description: "send button to enable" },
    );
    await page!.click(".chat-send-btn");

    await page!.waitForPath("/porta/conv-1");
    await page!.waitForText(prompt);
    await page!.waitForText(`Mock response for: ${prompt}`);
    await page!.waitForText("Implementation plan");

    expect(await page!.count(".message.user")).toBe(1);
    expect(await page!.count(".message.assistant")).toBe(1);
    expect(await page!.count(".implementation-plan-block")).toBe(1);

    await page!.click(".implementation-plan-header");
    await page!.waitFor(
      `Boolean(document.querySelector(".implementation-plan-block[open]"))`,
      { timeoutMs: 5_000, description: "implementation plan to expand" },
    );
    expect(await page!.bodyText()).toContain("Inspecting mock conversation state.");
  });
});
