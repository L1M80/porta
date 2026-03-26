import { useState } from "react";
import { useSessionActivity } from "../hooks/useSessionActivity";
import type { ActivityEventType } from "../hooks/useSessionActivity";
import type { TrajectoryStep } from "../types";
import {
  IconEye,
  IconPencil,
  IconSearch,
  IconList,
  IconFileSearch,
  IconTerminal,
  IconFile,
} from "./Icons";

interface Props {
  steps: TrajectoryStep[];
  loading?: boolean;
  onStepClick?: (step: TrajectoryStep) => void;
}

// ── Event label mapping ──

const EVENT_LABEL: Record<ActivityEventType, string> = {
  view: "View",
  edit: "Edit",
  grep: "Grep",
  outline: "Outline",
  "code-item": "Symbol",
};

function EventIcon({ type, size = 10 }: { type: ActivityEventType; size?: number }) {
  switch (type) {
    case "view":
      return <IconEye size={size} />;
    case "edit":
      return <IconPencil size={size} />;
    case "grep":
      return <IconSearch size={size} />;
    case "outline":
      return <IconList size={size} />;
    case "code-item":
      return <IconFileSearch size={size} />;
  }
}

function cmdStatusClass(exitCode?: number, status?: string): string {
  if (status === "CORTEX_STEP_STATUS_WAITING") return "wait";
  if (exitCode === undefined) return "";
  return exitCode === 0 ? "ok" : "fail";
}

// ── Main component ──

export function SessionActivity({ steps, loading, onStepClick }: Props) {
  const activity = useSessionActivity(steps);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (uri: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(uri)) {
        next.delete(uri);
      } else {
        next.add(uri);
      }
      return next;
    });
  };

  if (loading && steps.length === 0) {
    return (
      <div className="session-activity">
        <div className="sa-empty">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  const hasAny = activity.files.length > 0 || activity.commands.length > 0;

  if (!hasAny) {
    return (
      <div className="session-activity">
        <div className="sa-empty">
          No file or command activity yet.
          <br />
          Activity will appear as the agent works.
        </div>
      </div>
    );
  }

  return (
    <div className="session-activity">
      {/* ── Files ── */}
      {activity.files.length > 0 && (
        <>
          <div className="sa-section-label">Files</div>
          {activity.files.map((file) => {
            const isExpanded = expandedFiles.has(file.uri);
            return (
              <div key={file.uri} className="sa-file-item">
                <button
                  className="sa-file-header"
                  onClick={() => toggleFile(file.uri)}
                  title={file.uri.replace(/^file:\/\//, "")}
                >
                  <span className="sa-file-icon">
                    <IconFile size={11} />
                  </span>
                  <span className="sa-file-name">{file.name}</span>
                  <span className="sa-file-badge">{file.events.length}</span>
                  <span className={`sa-file-chevron ${isExpanded ? "open" : ""}`}>
                    ›
                  </span>
                </button>

                {isExpanded && (
                  <div className="sa-events">
                    {file.events.map((ev, i) => (
                      <div key={i} className="sa-event-row" onClick={() => onStepClick?.(ev.step)} style={{ cursor: onStepClick ? "pointer" : "default" }}>
                        <span className={`sa-event-icon ${ev.type}`}>
                          <EventIcon type={ev.type} size={10} />
                        </span>
                        <span className="sa-event-type">
                          {EVENT_LABEL[ev.type]}
                        </span>
                        {ev.detail && (
                          <span className="sa-event-detail">{ev.detail}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── Commands ── */}
      {activity.commands.length > 0 && (
        <>
          <div className="sa-section-label">Commands</div>
          {activity.commands.map((cmd) => {
            const cls = cmdStatusClass(cmd.exitCode, cmd.status);
            return (
              <div key={cmd.stepIndex} className="sa-cmd-row" onClick={() => onStepClick?.(cmd.step)} style={{ cursor: onStepClick ? "pointer" : "default" }}>
                <span className={`sa-cmd-icon ${cls}`}>
                  <IconTerminal size={11} />
                </span>
                <span className="sa-cmd-text" title={cmd.command}>
                  {cmd.command}
                </span>
                {cmd.exitCode !== undefined && (
                  <span className={`sa-cmd-exit ${cls}`}>
                    {cmd.exitCode === 0 ? "✓" : `✗${cmd.exitCode}`}
                  </span>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
