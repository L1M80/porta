import { useMemo } from "react";
import type { TrajectoryStep } from "../types";

// ── Types ──

export type ActivityEventType =
  | "view"
  | "edit"
  | "grep"
  | "outline"
  | "code-item";

export interface ActivityEvent {
  stepIndex: number;
  type: ActivityEventType;
  /** Human-readable context: line range, diff stats, query, etc. */
  detail?: string;
  step: TrajectoryStep;
}

export interface FileActivity {
  /** Absolute file URI e.g. file:///z:/project/src/App.tsx */
  uri: string;
  /** Display name (basename) */
  name: string;
  events: ActivityEvent[];
}

export interface CommandActivity {
  stepIndex: number;
  command: string;
  exitCode?: number;
  status?: string;
  step: TrajectoryStep;
}

export interface SessionActivity {
  /** Files referenced in the session, ordered by first appearance. */
  files: FileActivity[];
  /** Terminal commands run during the session. */
  commands: CommandActivity[];
}

// ── Helpers ──

function basename(uri: string): string {
  const cleaned = uri.replace(/^file:\/\//, "");
  return cleaned.split(/[\\/]/).pop() ?? cleaned;
}

function uriKey(uri: string): string {
  // Normalise so file:///z:/foo and file:///Z:/foo are the same
  return uri.toLowerCase().replace(/\\/g, "/");
}

// ── Core derivation ──

export function deriveSessionActivity(steps: TrajectoryStep[]): SessionActivity {
  const fileMap = new Map<string, FileActivity>();
  const commands: CommandActivity[] = [];

  const getFile = (uri: string): FileActivity => {
    const key = uriKey(uri);
    if (!fileMap.has(key)) {
      fileMap.set(key, { uri, name: basename(uri), events: [] });
    }
    return fileMap.get(key)!;
  };

  const addEvent = (uri: string, event: ActivityEvent) => {
    if (!uri) return;
    getFile(uri).events.push(event);
  };

  steps.forEach((step, i) => {
    const idx = i;

    // ── viewFile ──
    if (step.viewFile?.absolutePathUri) {
      const { absolutePathUri, startLine, endLine } = step.viewFile;
      let detail: string | undefined;
      if (startLine !== undefined && endLine !== undefined) {
        detail = `#L${startLine}–${endLine}`;
      } else if (startLine !== undefined) {
        detail = `#L${startLine}`;
      }
      addEvent(absolutePathUri, { stepIndex: idx, type: "view", detail, step });
    }

    // ── codeAction (file edit) ──
    if (step.codeAction?.actionResult?.edit?.absoluteUri) {
      const uri = step.codeAction.actionResult.edit.absoluteUri;
      const lines = step.codeAction.actionResult.edit.diff?.unifiedDiff?.lines ?? [];
      const adds = lines.filter((l) => l.type === "UNIFIED_DIFF_LINE_TYPE_INSERT").length;
      const dels = lines.filter((l) => l.type === "UNIFIED_DIFF_LINE_TYPE_DELETE").length;
      const detail = adds > 0 || dels > 0 ? `+${adds} −${dels}` : undefined;
      addEvent(uri, { stepIndex: idx, type: "edit", detail, step });
    }

    // ── grepSearch ──
    if (step.grepSearch?.searchPathUri) {
      const uri = step.grepSearch.searchPathUri;
      const detail = step.grepSearch.query
        ? `"${step.grepSearch.query}"`
        : undefined;
      addEvent(uri, { stepIndex: idx, type: "grep", detail, step });
    }

    // ── viewFileOutline ──
    if (step.viewFileOutline?.absolutePathUri) {
      addEvent(step.viewFileOutline.absolutePathUri, {
        stepIndex: idx,
        type: "outline",
        step,
      });
    }

    // ── viewCodeItem ──
    if (step.viewCodeItem?.absoluteUri) {
      const detail = step.viewCodeItem.nodePaths?.join(", ");
      addEvent(step.viewCodeItem.absoluteUri, {
        stepIndex: idx,
        type: "code-item",
        detail,
        step,
      });
    }

    // ── runCommand ──
    if (step.runCommand) {
      const cmd = step.runCommand;
      const command =
        cmd.commandLine ?? cmd.command ?? cmd.proposedCommandLine ?? "";
      if (command) {
        commands.push({
          stepIndex: idx,
          command,
          exitCode: cmd.exitCode,
          status: step.status,
          step,
        });
      }
    }
  });

  return {
    files: Array.from(fileMap.values()),
    commands,
  };
}

/** React hook that derives session activity from the steps array. */
export function useSessionActivity(steps: TrajectoryStep[]): SessionActivity {
  return useMemo(() => deriveSessionActivity(steps), [steps]);
}
