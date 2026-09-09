import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PermissionCard } from "../components/StepCards";
import type { PermissionRequest, TrajectoryStep } from "../types";
import { stepsToMessages } from "../transforms/stepsToMessages";

const permission: PermissionRequest = {
  resource: { action: "read_url", target: "example.com" },
  triggerSource: { type: "TYPE_DEFAULT_GRANT", detail: "read_url(*)" },
};

function waitingStep(overrides: Partial<TrajectoryStep> = {}): TrajectoryStep {
  return {
    // Shape captured from a live Antigravity 2.11 Language Server.
    type: "CORTEX_STEP_TYPE_GENERIC",
    status: "CORTEX_STEP_STATUS_WAITING",
    metadata: {
      sourceTrajectoryStepInfo: { trajectoryId: "traj-1", stepIndex: 12 },
      toolCall: { name: "read_url_content" },
    },
    requestedInteraction: { permission },
    generic: { args: { Url: "https://example.com", toolSummary: "Read URL content" } },
    ...overrides,
  };
}

describe("generic permissions", () => {
  it.each(["CORTEX_STEP_TYPE_GENERIC", "CORTEX_STEP_TYPE_READ_URL_CONTENT", "CORTEX_STEP_TYPE_MCP_TOOL", "UNKNOWN_TOOL"])(
    "preserves a confirmation attached to %s",
    (type) => {
      const step = waitingStep({ type });
      const messages = stepsToMessages([
        { type: "CORTEX_STEP_TYPE_USER_INPUT", userInput: { items: [{ text: "Go" }] } },
        step,
      ]);
      expect(messages[1]).toMatchObject({
        type: "CORTEX_STEP_TYPE_PERMISSION",
        stepIndex: 1,
        step,
      });
    },
  );

  it("keeps file and command approvals on their existing cards", () => {
    const messages = stepsToMessages([
      waitingStep({
        requestedInteraction: { permission: { resource: { action: "read_file", target: "/app/file" } } },
      }),
      waitingStep({
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        runCommand: { proposedCommandLine: "pnpm test" },
      }),
    ]);
    expect(messages.map(({ type }) => type)).toEqual([
      "CORTEX_STEP_TYPE_FILE_PERMISSION",
      "CORTEX_STEP_TYPE_RUN_COMMAND",
    ]);
  });

  it.each([true, false])("sends allow=%s for the exact requested step", async (allow) => {
    const onPermission = vi.fn().mockResolvedValue(undefined);
    render(<PermissionCard step={waitingStep()} permissionRequest={permission} fallbackStepIndex={0} onPermission={onPermission} />);
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("Allow web access to:")).toBeInTheDocument();
    expect(screen.getByText("Read URL content (read_url(*))")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: allow ? "Allow" : "Deny" }));
    expect(onPermission).toHaveBeenCalledWith("traj-1", 12, allow);
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });

  it("displays non-web actions and missing resource details", () => {
    render(<PermissionCard step={waitingStep({ metadata: { toolCall: { name: "custom_tool" } } })} permissionRequest={{}} fallbackStepIndex={0} />);
    expect(screen.getByText("Allow tool access:")).toBeInTheDocument();
    expect(screen.getByText("custom_tool")).toBeInTheDocument();
  });

  it("uses the message position when source metadata omits stepIndex", async () => {
    const onPermission = vi.fn().mockResolvedValue(undefined);
    render(<PermissionCard step={waitingStep({ metadata: { sourceTrajectoryStepInfo: { trajectoryId: "traj-1" } } })} permissionRequest={permission} fallbackStepIndex={23} onPermission={onPermission} />);
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(onPermission).toHaveBeenCalledWith("traj-1", 23, true);
  });

  it.each(["Allow", "Deny"])("restores controls after a failed %s response", async (name) => {
    const onPermission = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    render(<PermissionCard step={waitingStep()} permissionRequest={permission} fallbackStepIndex={0} onPermission={onPermission} />);
    await userEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please try again");
    await userEvent.click(screen.getByRole("button", { name }));
    expect(onPermission).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prevents duplicate responses while a request is pending", async () => {
    const onPermission = vi.fn(() => new Promise<void>(() => {}));
    render(<PermissionCard step={waitingStep()} permissionRequest={permission} fallbackStepIndex={0} onPermission={onPermission} />);
    await userEvent.dblClick(screen.getByRole("button", { name: "Allow" }));
    expect(onPermission).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
  });

  it.each(["CORTEX_STEP_STATUS_DONE", "CORTEX_STEP_STATUS_ERROR", "CORTEX_STEP_STATUS_RUNNING"])(
    "does not allow responses to a %s step", (status) => {
      render(<PermissionCard step={waitingStep({ status })} permissionRequest={permission} fallbackStepIndex={0} onPermission={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
    },
  );

  it("does not offer controls without a response handler", () => {
    render(<PermissionCard step={waitingStep()} permissionRequest={permission} fallbackStepIndex={0} />);
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });
});
