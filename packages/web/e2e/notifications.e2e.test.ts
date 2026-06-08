import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppHarness } from "./fixtures/appHarness";

const ORIGIN = "http://127.0.0.1:4173";

const USER_STEP = {
  type: "CORTEX_STEP_TYPE_USER_INPUT",
  userInput: {
    items: [{ text: "Notification check" }],
  },
};

const ASSISTANT_STEP = {
  type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
  plannerResponse: {
    modifiedResponse: "I finished the requested notification check.",
  },
};

function waitingCommandStep(command: string) {
  return {
    type: "CORTEX_STEP_TYPE_RUN_COMMAND",
    status: "CORTEX_STEP_STATUS_WAITING",
    metadata: {
      sourceTrajectoryStepInfo: {
        trajectoryId: "traj-notify",
        stepIndex: 2,
      },
    },
    runCommand: {
      proposedCommandLine: command,
    },
  };
}

async function installNotificationRecorder(
  page: Awaited<ReturnType<AppHarness["newPage"]>>,
) {
  await page.grantPermissions(["notifications"], ORIGIN);
  await page.evaluate(`(() => {
    const NativeNotification = window.Notification;
    const notifications = [];

    function RecordedNotification(title, options) {
      notifications.push({
        title,
        body: options?.body ?? "",
        tag: options?.tag ?? "",
        permission: NativeNotification.permission,
      });
      return new NativeNotification(title, options);
    }

    Object.defineProperty(RecordedNotification, "permission", {
      get: () => NativeNotification.permission,
    });
    RecordedNotification.requestPermission = async (callback) => {
      const permission = NativeNotification.permission;
      callback?.(permission);
      return permission;
    };

    Object.defineProperty(window, "__portaNotifications", {
      configurable: true,
      value: notifications,
    });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: RecordedNotification,
    });
  })()`);
}

async function makePageNeedAttention(
  page: Awaited<ReturnType<AppHarness["newPage"]>>,
) {
  await page.evaluate(`(() => {
    Object.defineProperty(document, "hasFocus", {
      configurable: true,
      value: () => false,
    });
  })()`);
}

async function triggerResumeRefresh(
  page: Awaited<ReturnType<AppHarness["newPage"]>>,
) {
  await page.evaluate(`window.dispatchEvent(new Event("focus"))`);
}

describe("browser notifications", () => {
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
    await page.navigate(harness!.url("/"));
    await page.evaluate(`localStorage.removeItem("porta:settings")`);
  });

  afterEach(async () => {
    await page?.close();
    page = null;
  });

  it("enables browser notifications from Settings", async () => {
    const app = harness!;

    await page!.navigate(app.url("/porta/settings"));
    await installNotificationRecorder(page!);

    await page!.click('input[aria-label="Browser Notifications"]');

    await page!.waitFor(
      `(() => {
        const raw = localStorage.getItem("porta:settings");
        return Boolean(raw && JSON.parse(raw).browserNotificationsEnabled === true);
      })()`,
      { timeoutMs: 5_000, description: "browser notification setting to save" },
    );

    expect(
      await page!.evaluate<string>(
        `document.querySelector(".settings-permission-status")?.textContent ?? ""`,
      ),
    ).toBe("On");
  });

  it("fires a browser notification for new command approval requests", async () => {
    const app = harness!;
    app.api.createConversation("conv-notify", {
      summary: "Notification test",
      steps: [USER_STEP],
    });

    await page!.navigate(app.url("/porta/settings"));
    await installNotificationRecorder(page!);
    await page!.click('input[aria-label="Browser Notifications"]');

    await page!.navigate(app.url("/porta/conv-notify"));
    await installNotificationRecorder(page!);
    await page!.waitForText("Notification check");
    await makePageNeedAttention(page!);

    app.api.setConversationSteps("conv-notify", [
      USER_STEP,
      waitingCommandStep("pnpm test"),
    ]);
    await triggerResumeRefresh(page!);

    await page!.waitFor(
      `window.__portaNotifications?.some((notification) =>
        notification.title === "Porta needs approval" &&
        notification.body === "pnpm test" &&
        notification.permission === "granted"
      )`,
      { timeoutMs: 10_000, description: "approval notification to fire" },
    );
  });

  it("fires a browser notification when a running conversation becomes idle", async () => {
    const app = harness!;
    app.api.createConversation("conv-run", {
      summary: "Run finished test",
      status: "CASCADE_RUN_STATUS_RUNNING",
      steps: [USER_STEP, ASSISTANT_STEP],
    });

    await page!.navigate(app.url("/porta/settings"));
    await installNotificationRecorder(page!);
    await page!.click('input[aria-label="Browser Notifications"]');

    await page!.navigate(app.url("/porta/conv-run"));
    await installNotificationRecorder(page!);
    await page!.waitForText("Notification check");
    await makePageNeedAttention(page!);

    app.api.setConversationStatus("conv-run", "CASCADE_RUN_STATUS_IDLE");
    await triggerResumeRefresh(page!);

    await page!.waitFor(
      `window.__portaNotifications?.some((notification) =>
        notification.title === "Porta job finished" &&
        notification.body === "I finished the requested notification check." &&
        notification.permission === "granted"
      )`,
      { timeoutMs: 10_000, description: "run-finished notification to fire" },
    );
  });
});
