import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "../components/ChatPanel";
import { useStepsStream } from "../hooks/useStepsStream";
import type { TrajectoryStep } from "../types";

vi.mock("../hooks/useStepsStream", () => ({
  useStepsStream: vi.fn(),
}));

vi.mock("../hooks/useChatNotifications", () => ({
  useChatNotifications: vi.fn(),
}));

const mockUseStepsStream = vi.mocked(useStepsStream);

function mockSteps(steps: TrajectoryStep[], wsRunning = false) {
  mockUseStepsStream.mockReturnValue({
    steps,
    loading: false,
    error: null,
    hasMore: false,
    loadingOlder: false,
    wsRunning,
    loadOlder: vi.fn().mockResolvedValue(0),
    refresh: vi.fn(),
    hardRefresh: vi.fn(),
  });
}

describe("ChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders planner thinking as an implementation plan panel", () => {
    mockSteps([
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          modifiedResponse: "I will make the change.",
          thinking: "Inspect the current chat UI, then expose the plan.",
          thinkingDuration: "3.4s",
        },
      },
    ]);

    render(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );

    expect(screen.getByText("Implementation plan")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.getByText("3.4s")).toBeInTheDocument();
    expect(
      screen.getByText("Inspect the current chat UI, then expose the plan."),
    ).toBeInTheDocument();
  });

  it("shows the latest plan as a live panel while the run is active", () => {
    mockSteps(
      [
        {
          type: "CORTEX_STEP_TYPE_USER_INPUT",
          userInput: { items: [{ text: "Please implement this" }] },
        },
        {
          type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
          plannerResponse: {
            thinking: "Inspect first, then patch the UI.",
            thinkingDuration: "1.2s",
          },
        },
      ],
      true,
    );

    render(
      <ChatPanel
        cascadeId="cascade-1"
        onRevert={vi.fn()}
        onFilePermission={vi.fn()}
      />,
    );

    expect(screen.getByText("Live implementation plan")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("Hide")).toBeInTheDocument();
    expect(
      document.querySelector(".pinned-implementation-plan-message"),
    ).toBeInTheDocument();
  });

  it("keeps the live plan pinned above the answer after the run ends", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "Please implement this" }] },
      },
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          thinking: "Inspect first, then patch the UI.",
          thinkingDuration: "1.2s",
        },
      },
    ];
    const completedSteps: TrajectoryStep[] = [
      ...steps,
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: {
          modifiedResponse: "Final answer.",
        },
      },
    ];
    const props = {
      cascadeId: "cascade-1",
      onRevert: vi.fn(),
      onFilePermission: vi.fn(),
    };

    mockSteps(steps, true);
    const { rerender } = render(<ChatPanel {...props} />);
    expect(screen.getByText("Live implementation plan")).toBeInTheDocument();

    mockSteps(completedSteps, false);
    rerender(<ChatPanel {...props} />);

    expect(
      screen.queryByText("Live implementation plan"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.getByText("Implementation plan")).toBeInTheDocument();
    const messageElements = Array.from(document.querySelectorAll(".message"));
    const planElement = document.querySelector(
      ".pinned-implementation-plan-message",
    );
    const answerElement = screen.getByText("Final answer.");
    const planIndex = messageElements.indexOf(planElement as Element);
    const answerIndex = messageElements.findIndex((element) =>
      element.contains(answerElement),
    );

    expect(planElement).toBeInTheDocument();
    expect(planIndex).toBeGreaterThanOrEqual(0);
    expect(answerIndex).toBeGreaterThan(planIndex);
  });
});
