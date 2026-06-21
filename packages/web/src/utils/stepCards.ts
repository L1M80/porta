import type {
  AskQuestionRequest,
  FilePermissionRequest,
  TrajectoryStep,
} from "../types";

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
  return (
    step.filePermissionRequest ??
    step.viewFile?.filePermissionRequest ??
    step.listDirectory?.filePermissionRequest ??
    step.codeAction?.filePermissionRequest ??
    step.grepSearch?.filePermissionRequest ??
    step.viewFileOutline?.filePermissionRequest ??
    step.viewCodeItem?.filePermissionRequest
  );
}

export function getAskQuestionRequest(
  step: TrajectoryStep,
): AskQuestionRequest | undefined {
  const request = step.askQuestion ?? step.requestedInteraction?.askQuestion;
  return request?.questions && request.questions.length > 0
    ? request
    : undefined;
}
