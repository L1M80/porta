import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { CommandCard } from "../components/StepCards";
import type { TrajectoryStep } from "../types";

/** Helper: build a WAITING run-command step */
function waitingStep(overrides: Partial<TrajectoryStep> = {}): TrajectoryStep {
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
      proposedCommandLine: "npm install",
      cwd: "/app",
    },
    ...overrides,
  };
}

describe("CommandCard", () => {
  it("shows approve/reject buttons when step is WAITING", () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <CommandCard step={waitingStep()} onCommandAction={onAction} />,
    );

    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
    expect(screen.getByText("Waiting for approval")).toBeInTheDocument();
  });

  it("does not show buttons when step is not WAITING", () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_RUN_COMMAND",
      status: "CORTEX_STEP_STATUS_DONE",
      runCommand: { commandLine: "ls", exitCode: 0 },
    };
    render(<CommandCard step={step} onCommandAction={onAction} />);

    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("Reject")).not.toBeInTheDocument();
  });

  it("does not show buttons without onCommandAction callback", () => {
    render(<CommandCard step={waitingStep()} />);

    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });

  it("hides buttons after successful approval", async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    render(
      <CommandCard step={waitingStep()} onCommandAction={onAction} />,
    );

    await userEvent.click(screen.getByText("Approve"));

    expect(onAction).toHaveBeenCalledWith("traj-1", 7, true);
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
  });

  it("restores buttons after failed approval (retry path)", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("network error"));
    render(
      <CommandCard step={waitingStep()} onCommandAction={onAction} />,
    );

    await userEvent.click(screen.getByText("Approve"));

    // Buttons must reappear so the user can retry
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });

  it("restores buttons after failed rejection (retry path)", async () => {
    const onAction = vi.fn().mockRejectedValue(new Error("timeout"));
    render(
      <CommandCard step={waitingStep()} onCommandAction={onAction} />,
    );

    await userEvent.click(screen.getByText("Reject"));

    expect(onAction).toHaveBeenCalledWith("traj-1", 7, false);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });

  it("shows proposedCommandLine when waiting", () => {
    render(<CommandCard step={waitingStep()} />);

    expect(screen.getByText("npm install")).toBeInTheDocument();
  });

  it("shows commandLine (not proposedCommandLine) when not waiting", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_RUN_COMMAND",
      status: "CORTEX_STEP_STATUS_DONE",
      runCommand: {
        commandLine: "npm test",
        proposedCommandLine: "npm install",
        exitCode: 0,
      },
    };
    render(<CommandCard step={step} />);

    expect(screen.getByText("npm test")).toBeInTheDocument();
  });
});
