import { useState } from "react";
import {
  IconCopy,
  IconCheck,
  IconTerminal,
  IconPencil,
  IconFile,
  IconFileText,
  IconLock,
} from "./Icons";
import type { TrajectoryStep, FilePermissionRequest } from "../types";

/** Extract file basename from a URI or path */
function basename(uriOrPath: string): string {
  const cleaned = uriOrPath.replace(/^file:\/\//, "");
  return cleaned.split("/").pop() ?? cleaned;
}

/** Inline copy button for step cards */
function StepCopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="msg-action-btn step-copy-btn"
      title="Copy"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );
}

// ── File Permission Card ──

/** Permission scope enum values matching the LS proto */
const PERMISSION_SCOPE_ONCE = 1;
const PERMISSION_SCOPE_CONVERSATION = 2;

interface FilePermissionCardProps {
  step: TrajectoryStep;
  permissionRequest: FilePermissionRequest;
  onFilePermission: (
    trajectoryId: string,
    stepIndex: number,
    allow: boolean,
    scope: number,
    absolutePathUri: string,
  ) => void;
}

export function FilePermissionCard({
  step,
  permissionRequest,
  onFilePermission,
}: FilePermissionCardProps) {
  const [responded, setResponded] = useState(false);
  const isWaiting = step.status === "CORTEX_STEP_STATUS_WAITING";

  const trajectoryId =
    step.metadata?.sourceTrajectoryStepInfo?.trajectoryId ?? "";
  const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? 0;

  const path = permissionRequest.absolutePathUri;
  const displayPath = path.length > 60 ? "…" + path.slice(-55) : path;
  const isDir = permissionRequest.isDirectory ?? false;

  const handleResponse = (allow: boolean, scope: number) => {
    setResponded(true);
    onFilePermission(trajectoryId, stepIndex, allow, scope, path);
  };

  return (
    <div
      className={`chat-block step-card file-permission-card ${responded ? "cmd-ok" : isWaiting ? "cmd-wait" : ""}`}
    >
      <div className="step-card-header">
        <span className="step-card-icon">
          <IconLock size={12} />
        </span>
        <span className="step-card-desc">
          File access requested:{" "}
          <code className="step-card-file">{displayPath}</code>
          {isDir ? " (directory)" : ""}
        </span>
      </div>
      {permissionRequest.blockReason && (
        <div className="step-card-cwd">
          {permissionRequest.blockReason
            .replace("BLOCK_REASON_", "")
            .replace(/_/g, " ")
            .toLowerCase()}
        </div>
      )}
      {isWaiting && !responded && (
        <div className="step-card-actions file-permission-actions">
          <button
            className="approve-btn file-permission-btn deny"
            onClick={() => handleResponse(false, 0)}
          >
            Deny
          </button>
          <button
            className="approve-btn file-permission-btn allow-once"
            onClick={() => handleResponse(true, PERMISSION_SCOPE_ONCE)}
          >
            Allow Once
          </button>
          <button
            className="approve-btn file-permission-btn allow-conversation"
            onClick={() => handleResponse(true, PERMISSION_SCOPE_CONVERSATION)}
          >
            Allow This Conversation
          </button>
        </div>
      )}
    </div>
  );
}

// ── Command Card ──

interface CommandCardProps {
  step: TrajectoryStep;
  onCommandAction?: (
    trajectoryId: string,
    stepIndex: number,
    approved: boolean,
  ) => Promise<void>;
}

export function CommandCard({ step, onCommandAction }: CommandCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [responded, setResponded] = useState(false);
  const cmd = step.runCommand;
  if (!cmd) return null;

  const isWaiting = step.status === "CORTEX_STEP_STATUS_WAITING";
  // When waiting for approval, show the proposed command; otherwise show executed
  const command = isWaiting
    ? (cmd.proposedCommandLine ?? cmd.commandLine ?? cmd.command ?? "")
    : (cmd.commandLine ?? cmd.command ?? "");
  const output = cmd.combinedOutput?.full ?? cmd.output ?? "";
  const cwd = cmd.cwd;
  const exitCode = cmd.exitCode;

  const trajectoryId =
    step.metadata?.sourceTrajectoryStepInfo?.trajectoryId ?? "";
  const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? 0;

  const statusClass = isWaiting
    ? "cmd-wait"
    : exitCode === undefined
      ? ""
      : exitCode === 0
        ? "cmd-ok"
        : "cmd-fail";

  const handleAction = async (approved: boolean) => {
    if (!onCommandAction) return;
    setResponded(true);
    try {
      await onCommandAction(trajectoryId, stepIndex, approved);
    } catch {
      // Request failed — restore buttons so user can retry
      setResponded(false);
    }
  };

  return (
    <div className={`chat-block step-card command-card ${statusClass}`}>
      <button
        className="step-card-header"
        onClick={() => output && setExpanded((v) => !v)}
        title={output ? "Toggle output" : undefined}
      >
        <span className="step-card-icon">
          <IconTerminal size={12} />
        </span>
        <code className="step-card-command">{command}</code>
        {output && (
          <span className={`step-card-chevron ${expanded ? "open" : ""}`}>
            ▾
          </span>
        )}
      </button>
      {cwd && <div className="step-card-cwd">{cwd}</div>}
      {isWaiting && !responded && onCommandAction && (
        <div className="step-card-actions command-action-bar">
          <span className="command-waiting-label">
            <span className="waiting-dot" />
            Waiting for approval
          </span>
          <div className="command-action-buttons">
            <button
              className="approve-btn command-action-btn reject"
              onClick={() => handleAction(false)}
            >
              Reject
            </button>
            <button
              className="approve-btn command-action-btn approve"
              onClick={() => handleAction(true)}
            >
              Approve
            </button>
          </div>
        </div>
      )}
      {expanded && output && <pre className="step-card-output">{output}</pre>}
      <StepCopyBtn text={output ? `$ ${command}\n${output}` : `$ ${command}`} />
    </div>
  );
}

// ── Code Action Card ──

interface CodeActionCardProps {
  step: TrajectoryStep;
}

/** Diff line types from the LS proto */
type DiffLineType =
  | "UNIFIED_DIFF_LINE_TYPE_UNCHANGED"
  | "UNIFIED_DIFF_LINE_TYPE_INSERT"
  | "UNIFIED_DIFF_LINE_TYPE_DELETE"
  | "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER";

interface DiffLine {
  text?: string;
  type: DiffLineType;
}

function diffLinePrefix(type: DiffLineType): string {
  if (type === "UNIFIED_DIFF_LINE_TYPE_INSERT") return "+";
  if (type === "UNIFIED_DIFF_LINE_TYPE_DELETE") return "-";
  if (type === "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER") return "@@";
  return " ";
}

function diffLineClass(type: DiffLineType): string {
  if (type === "UNIFIED_DIFF_LINE_TYPE_INSERT") return "diff-add";
  if (type === "UNIFIED_DIFF_LINE_TYPE_DELETE") return "diff-del";
  if (type === "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER") return "diff-hunk";
  return "";
}

export function CodeActionCard({ step }: CodeActionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const ca = step.codeAction;
  if (!ca) return null;

  const toolName = step.metadata?.toolCall?.name ?? "";

  const description = ca.description ?? "Code change";
  const fileUri: string = ca.actionResult?.edit?.absoluteUri ?? "";
  const fileName = fileUri ? basename(fileUri) : "";
  const diffLines: DiffLine[] =
    ca.actionResult?.edit?.diff?.unifiedDiff?.lines ?? [];
  const hasDiff = diffLines.length > 0;

  // Determine icon based on tool
  let iconEl = <IconFileText size={12} />;
  if (toolName === "write_to_file") iconEl = <IconFile size={12} />;
  else if (
    toolName === "multi_replace_file_content" ||
    toolName === "replace_file_content"
  )
    iconEl = <IconPencil size={12} />;

  // Count additions/deletions
  const additions = diffLines.filter(
    (l) => l.type === "UNIFIED_DIFF_LINE_TYPE_INSERT",
  ).length;
  const deletions = diffLines.filter(
    (l) => l.type === "UNIFIED_DIFF_LINE_TYPE_DELETE",
  ).length;

  return (
    <div className="chat-block step-card code-card">
      <button
        className="step-card-header"
        onClick={() => hasDiff && setExpanded((v) => !v)}
        title={hasDiff ? "Toggle diff" : undefined}
      >
        <span className="step-card-icon">{iconEl}</span>
        <span className="diff-stat">
          <span className="diff-stat-add">+{additions}</span>
          <span className="diff-stat-del">-{deletions}</span>
        </span>
        {fileName && <code className="step-card-file">{fileName}</code>}
        <span className="step-card-desc">{description}</span>
        {hasDiff && (
          <span className={`step-card-chevron ${expanded ? "open" : ""}`}>
            ▾
          </span>
        )}
      </button>
      {expanded && hasDiff && (
        <div className="step-card-diff">
          {fileUri && (
            <div className="diff-file-header">
              {fileUri.replace("file://", "")}
            </div>
          )}
          <pre className="diff-content">
            {diffLines.map((line, i) => (
              <div key={i} className={`diff-line ${diffLineClass(line.type)}`}>
                <span className="diff-prefix">{diffLinePrefix(line.type)}</span>
                <span className="diff-text">{line.text ?? ""}</span>
              </div>
            ))}
          </pre>
        </div>
      )}
    </div>
  );
}
