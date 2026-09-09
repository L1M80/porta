import type {
  AskQuestionRequest,
  FilePermissionRequest,
  PermissionRequest,
  TrajectoryStep,
} from "../types";

/** Permissions can be attached to any tool, including unknown step types. */
export function getPermissionRequest(
  step: TrajectoryStep,
): PermissionRequest | undefined {
  return step.requestedInteraction?.permission;
}

/**
 * Extract a filePermissionRequest from any of the tool data fields
 * where the LS may embed it, or from the step's top-level field.
 *
 * The LS embeds filePermissionRequest in 6 step types:
 * CodeAction, ViewFile, ListDirectory, GrepSearch, ViewFileOutline, ViewCodeItem.
 */
export function getFilePermissionRequest(
  step: TrajectoryStep,
): FilePermissionRequest | undefined {
  let fpr =
    step.filePermissionRequest ??
    step.viewFile?.filePermissionRequest ??
    step.listDirectory?.filePermissionRequest ??
    step.codeAction?.filePermissionRequest ??
    step.grepSearch?.filePermissionRequest ??
    step.viewFileOutline?.filePermissionRequest ??
    step.viewCodeItem?.filePermissionRequest;

  if (fpr) {
    fpr = {
      ...fpr,
      action:
        fpr.action ?? (step.codeAction ? "write_file" : "read_file"),
      responseKind: "filePermission",
    };
  }

  if (!fpr && step.requestedInteraction?.permission) {
    const perm = step.requestedInteraction.permission;
    if (
      perm.resource &&
      (perm.resource.action === "read_file" ||
        perm.resource.action === "write_file")
    ) {
      fpr = {
        absolutePathUri: perm.resource.target ?? "",
        isDirectory: false,
        action: perm.resource.action,
        responseKind: "permission",
      };
    }
  }

  return fpr;
}

export function getAskQuestionRequest(
  step: TrajectoryStep,
): AskQuestionRequest | undefined {
  const request = step.askQuestion ?? step.requestedInteraction?.askQuestion;
  return request?.questions && request.questions.length > 0
    ? request
    : undefined;
}
