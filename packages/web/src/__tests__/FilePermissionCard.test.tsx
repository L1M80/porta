import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilePermissionCard } from "../components/StepCards";
import type { FilePermissionRequest, TrajectoryStep } from "../types";
import { getFilePermissionRequest } from "../utils/stepCards";

const permissionRequest: FilePermissionRequest = {
  absolutePathUri: "file:///app/src/App.tsx",
  action: "write_file",
};

const genericPermissionRequest: FilePermissionRequest = {
  ...permissionRequest,
  responseKind: "permission",
};

function waitingStep(
  overrides: Partial<TrajectoryStep> = {},
): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_CODE_ACTION",
    status: "CORTEX_STEP_STATUS_WAITING",
    metadata: {
      sourceTrajectoryStepInfo: {
        trajectoryId: "traj-1",
        stepIndex: 7,
      },
    },
    ...overrides,
  };
}

describe("FilePermissionCard", () => {
  it("uses the generic permission response for requestedInteraction", async () => {
    const onFilePermission = vi.fn();
    const onPermission = vi.fn().mockResolvedValue(undefined);
    const step = waitingStep({
      requestedInteraction: {
        permission: {
          resource: {
            action: "write_file",
            target: permissionRequest.absolutePathUri,
          },
        },
      },
    });

    render(
      <FilePermissionCard
        step={step}
        permissionRequest={genericPermissionRequest}
        onFilePermission={onFilePermission}
        onGenericPermission={onPermission}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Allow" }));

    expect(onPermission).toHaveBeenCalledWith("traj-1", 7, true);
    expect(onFilePermission).not.toHaveBeenCalled();
  });

  it("keeps legacy file permission requests on the scoped response", async () => {
    const onFilePermission = vi.fn();
    const onPermission = vi.fn().mockResolvedValue(undefined);

    render(
      <FilePermissionCard
        step={waitingStep()}
        permissionRequest={permissionRequest}
        onFilePermission={onFilePermission}
        onGenericPermission={onPermission}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Allow This Conversation" }),
    );

    expect(onFilePermission).toHaveBeenCalledWith(
      "traj-1",
      7,
      true,
      2,
      permissionRequest.absolutePathUri,
    );
    expect(onPermission).not.toHaveBeenCalled();
  });

  it("does not offer an unusable response without a permission handler", () => {
    const step = waitingStep({
      requestedInteraction: {
        permission: {
          resource: {
            action: "read_file",
            target: permissionRequest.absolutePathUri,
          },
        },
      },
    });

    render(
      <FilePermissionCard
        step={step}
        permissionRequest={genericPermissionRequest}
        onFilePermission={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Allow" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Deny" }),
    ).not.toBeInTheDocument();
  });

  it("marks requestedInteraction resources for generic responses", () => {
    const request = getFilePermissionRequest({
      type: "CORTEX_STEP_TYPE_REQUESTED_INTERACTION",
      requestedInteraction: {
        permission: {
          resource: {
            action: "read_file",
            target: "file:///app/README.md",
          },
        },
      },
    });

    expect(request).toEqual({
      absolutePathUri: "file:///app/README.md",
      isDirectory: false,
      action: "read_file",
      responseKind: "permission",
    });
  });
});
