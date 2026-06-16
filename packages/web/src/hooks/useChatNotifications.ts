import { useEffect, useRef } from "react";
import { getFilePermissionRequest } from "../utils/stepCards";
import { showBrowserNotification } from "../utils/browserNotifications";
import type { TrajectoryStep } from "../types";

const WAITING_STATUS = "CORTEX_STEP_STATUS_WAITING";

interface UseChatNotificationsOptions {
  cascadeId: string;
  steps: TrajectoryStep[];
  loading: boolean;
  wsRunning: boolean;
  isConversationRunning: boolean;
  enabled: boolean;
  conversationTitle?: string;
}

interface PendingApprovalNotification {
  key: string;
  title: string;
  body: string;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}...`;
}

function cleanNotificationText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function latestAssistantReplyPreview(steps: TrajectoryStep[]): string | null {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index];
    if (step.type !== "CORTEX_STEP_TYPE_PLANNER_RESPONSE") continue;

    const response =
      step.plannerResponse?.modifiedResponse ??
      step.plannerResponse?.items
        ?.map((item) => item.text)
        .filter((text): text is string => Boolean(text?.trim()))
        .join("\n\n") ??
      "";
    const cleaned = cleanNotificationText(response);
    if (cleaned) return truncate(cleaned, 180);
  }

  return null;
}

function stepIdentity(step: TrajectoryStep, index: number): string {
  const info = step.metadata?.sourceTrajectoryStepInfo;
  const trajectoryId =
    info?.trajectoryId ?? step.metadata?.toolCall?.id ?? "local";
  const stepIndex = info?.stepIndex ?? index;
  return `${trajectoryId}:${stepIndex}`;
}

function pendingApprovalNotifications(
  steps: TrajectoryStep[],
): PendingApprovalNotification[] {
  const notifications: PendingApprovalNotification[] = [];

  steps.forEach((step, index) => {
    if (step.status !== WAITING_STATUS) return;

    const identity = stepIdentity(step, index);
    const filePermissionRequest = getFilePermissionRequest(step);
    if (filePermissionRequest) {
      const path = filePermissionRequest.absolutePathUri.replace(
        /^file:\/\//,
        "",
      );
      notifications.push({
        key: `file:${identity}:${filePermissionRequest.absolutePathUri}`,
        title: "Porta needs file access",
        body: truncate(path, 120),
      });
      return;
    }

    if (step.type !== "CORTEX_STEP_TYPE_RUN_COMMAND" || !step.runCommand) {
      return;
    }

    const command =
      step.runCommand.proposedCommandLine ??
      step.runCommand.commandLine ??
      step.runCommand.command ??
      "";

    notifications.push({
      key: `command:${identity}:${command}`,
      title: "Porta needs approval",
      body: command ? truncate(command, 120) : "Approve or reject a command.",
    });
  });

  return notifications;
}

export function useChatNotifications({
  cascadeId,
  steps,
  loading,
  wsRunning,
  isConversationRunning,
  enabled,
  conversationTitle,
}: UseChatNotificationsOptions): void {
  const initializedRef = useRef(false);
  const seenApprovalKeysRef = useRef<Set<string>>(new Set());
  const prevWsRunningRef = useRef(wsRunning);
  const prevOverallRunningRef = useRef(wsRunning || isConversationRunning);
  const runFinishedNotifiedRef = useRef(false);
  const cascadeRef = useRef(cascadeId);

  useEffect(() => {
    if (cascadeRef.current === cascadeId) return;

    cascadeRef.current = cascadeId;
    initializedRef.current = false;
    seenApprovalKeysRef.current = new Set();
    prevWsRunningRef.current = wsRunning;
    prevOverallRunningRef.current = wsRunning || isConversationRunning;
    runFinishedNotifiedRef.current = false;
  }, [cascadeId, isConversationRunning, wsRunning]);

  useEffect(() => {
    if (loading) return;

    const pendingApprovals = pendingApprovalNotifications(steps);
    const currentPendingKeys = pendingApprovals.map(({ key }) => key);

    if (!initializedRef.current) {
      initializedRef.current = true;
      seenApprovalKeysRef.current = new Set(currentPendingKeys);
      prevWsRunningRef.current = wsRunning;
      prevOverallRunningRef.current = wsRunning || isConversationRunning;
      return;
    }

    const overallRunning = wsRunning || isConversationRunning;
    const startedRunning =
      (!prevWsRunningRef.current && wsRunning) ||
      (!prevOverallRunningRef.current && overallRunning);

    if (startedRunning) {
      runFinishedNotifiedRef.current = false;
    }

    const finishedRunning =
      (prevWsRunningRef.current && !wsRunning) ||
      (prevOverallRunningRef.current && !overallRunning);

    if (finishedRunning && !runFinishedNotifiedRef.current) {
      if (enabled) {
        const latestReply = latestAssistantReplyPreview(steps);
        showBrowserNotification({
          title: "Porta job finished",
          body:
            latestReply ??
            (conversationTitle
              ? `${conversationTitle} is now idle.`
              : "The current session is now idle."),
          tag: `porta:${cascadeId}:run-finished`,
        });
      }
      runFinishedNotifiedRef.current = true;
    }

    for (const notification of pendingApprovals) {
      if (seenApprovalKeysRef.current.has(notification.key)) continue;

      if (enabled) {
        showBrowserNotification({
          title: notification.title,
          body: notification.body,
          tag: `porta:${cascadeId}:${notification.key}`,
        });
      }
      seenApprovalKeysRef.current.add(notification.key);
    }

    prevWsRunningRef.current = wsRunning;
    prevOverallRunningRef.current = overallRunning;
  }, [
    cascadeId,
    conversationTitle,
    enabled,
    isConversationRunning,
    loading,
    steps,
    wsRunning,
  ]);
}
