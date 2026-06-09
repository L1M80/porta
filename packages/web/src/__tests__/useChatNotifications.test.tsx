import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useChatNotifications } from "../hooks/useChatNotifications";
import { showBrowserNotification } from "../utils/browserNotifications";
import type { TrajectoryStep } from "../types";

vi.mock("../utils/browserNotifications", () => ({
  showBrowserNotification: vi.fn(),
}));

const showBrowserNotificationMock = vi.mocked(showBrowserNotification);

function waitingCommandStep(command = "npm install"): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_RUN_COMMAND",
    status: "CORTEX_STEP_STATUS_WAITING",
    metadata: {
      sourceTrajectoryStepInfo: {
        trajectoryId: "traj-1",
        stepIndex: 7,
      },
    },
    runCommand: {
      proposedCommandLine: command,
    },
  };
}

function waitingFilePermissionStep(path = "file:///app/src/App.tsx"): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_VIEW_FILE",
    status: "CORTEX_STEP_STATUS_WAITING",
    metadata: {
      sourceTrajectoryStepInfo: {
        trajectoryId: "traj-1",
        stepIndex: 8,
      },
    },
    viewFile: {
      absolutePathUri: path,
      filePermissionRequest: {
        absolutePathUri: path,
      },
    },
  };
}

function assistantResponseStep(text: string): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
    plannerResponse: {
      modifiedResponse: text,
    },
  };
}

describe("useChatNotifications", () => {
  beforeEach(() => {
    showBrowserNotificationMock.mockClear();
  });

  it("does not notify for approval requests present on initial load", () => {
    renderHook(() =>
      useChatNotifications({
        cascadeId: "cascade-1",
        steps: [waitingCommandStep()],
        loading: false,
        wsRunning: false,
        isConversationRunning: false,
        enabled: true,
        conversationTitle: "Session",
      }),
    );

    expect(showBrowserNotificationMock).not.toHaveBeenCalled();
  });

  it("notifies once for new command approval requests", () => {
    const { rerender } = renderHook(
      ({ steps }) =>
        useChatNotifications({
          cascadeId: "cascade-1",
          steps,
          loading: false,
          wsRunning: false,
          isConversationRunning: false,
          enabled: true,
          conversationTitle: "Session",
        }),
      { initialProps: { steps: [] as TrajectoryStep[] } },
    );

    rerender({ steps: [waitingCommandStep("pnpm test")] });
    rerender({ steps: [waitingCommandStep("pnpm test")] });

    expect(showBrowserNotificationMock).toHaveBeenCalledTimes(1);
    expect(showBrowserNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Porta needs approval",
        body: "pnpm test",
        tag: expect.stringContaining("command:traj-1:7:pnpm test"),
      }),
    );
  });

  it("notifies for new file permission requests", () => {
    const { rerender } = renderHook(
      ({ steps }) =>
        useChatNotifications({
          cascadeId: "cascade-1",
          steps,
          loading: false,
          wsRunning: false,
          isConversationRunning: false,
          enabled: true,
        }),
      { initialProps: { steps: [] as TrajectoryStep[] } },
    );

    rerender({ steps: [waitingFilePermissionStep()] });

    expect(showBrowserNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Porta needs file access",
        body: "/app/src/App.tsx",
      }),
    );
  });

  it("notifies once when websocket running transitions to idle", () => {
    const { rerender } = renderHook(
      ({ wsRunning }) =>
        useChatNotifications({
          cascadeId: "cascade-1",
          steps: [
            assistantResponseStep(
              "Build completed successfully. I updated the notification tests.",
            ),
          ],
          loading: false,
          wsRunning,
          isConversationRunning: false,
          enabled: true,
          conversationTitle: "Build",
        }),
      { initialProps: { wsRunning: true } },
    );

    rerender({ wsRunning: false });
    rerender({ wsRunning: false });

    expect(showBrowserNotificationMock).toHaveBeenCalledTimes(1);
    expect(showBrowserNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Porta job finished",
        body: "Build completed successfully. I updated the notification tests.",
      }),
    );
  });

  it("tracks events while disabled without replaying them after enabling", () => {
    const { rerender } = renderHook(
      ({ enabled, steps }) =>
        useChatNotifications({
          cascadeId: "cascade-1",
          steps,
          loading: false,
          wsRunning: false,
          isConversationRunning: false,
          enabled,
        }),
      {
        initialProps: {
          enabled: false,
          steps: [] as TrajectoryStep[],
        },
      },
    );

    rerender({ enabled: false, steps: [waitingCommandStep()] });
    rerender({ enabled: true, steps: [waitingCommandStep()] });

    expect(showBrowserNotificationMock).not.toHaveBeenCalled();
  });
});
