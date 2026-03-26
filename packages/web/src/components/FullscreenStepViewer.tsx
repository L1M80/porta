import { useMemo } from "react";
import type { TrajectoryStep } from "../types";
import { IconFileText, IconPencil, IconX, IconChevronLeft, IconChevronRight } from "./Icons";

type DiffLineType =
  | "UNIFIED_DIFF_LINE_TYPE_UNCHANGED"
  | "UNIFIED_DIFF_LINE_TYPE_INSERT"
  | "UNIFIED_DIFF_LINE_TYPE_DELETE"
  | "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER";

interface DiffLine {
  text?: string;
  type: DiffLineType;
  oldNum?: number | null;
  newNum?: number | null;
}

function getStepUri(step: TrajectoryStep): string | null {
  return (
    step.codeAction?.actionResult?.edit?.absoluteUri ||
    step.viewFile?.absolutePathUri ||
    step.viewCodeItem?.absoluteUri ||
    step.viewFileOutline?.absolutePathUri ||
    step.grepSearch?.searchPathUri ||
    null
  );
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

interface FullscreenStepViewerProps {
  step: TrajectoryStep;
  allSteps: TrajectoryStep[];
  onStepChange: (step: TrajectoryStep) => void;
  onClose: () => void;
}

export function FullscreenStepViewer({ 
  step, 
  allSteps, 
  onStepChange, 
  onClose 
}: FullscreenStepViewerProps) {
  const currentUri = useMemo(() => getStepUri(step), [step]);
  
  const fileHistory = useMemo(() => {
    if (!currentUri) return [];
    // We filter all steps that contain edits (diffs) for this same file
    return allSteps.filter(s => {
      const uri = getStepUri(s);
      if (uri !== currentUri) return false;
      const lines = s.codeAction?.actionResult?.edit?.diff?.unifiedDiff?.lines ?? [];
      return lines.length > 0;
    });
  }, [allSteps, currentUri]);

  const currentIndex = fileHistory.indexOf(step);
  const totalRevisions = fileHistory.length;
  const hasHistory = totalRevisions > 1;

  const handlePrev = () => {
    if (currentIndex > 0) onStepChange(fileHistory[currentIndex - 1]);
  };

  const handleNext = () => {
    if (currentIndex < totalRevisions - 1) onStepChange(fileHistory[currentIndex + 1]);
  };
  // Diff Extraction
  const diffLinesRaw: DiffLine[] =
    step.codeAction?.actionResult?.edit?.diff?.unifiedDiff?.lines ?? [];
  const hasDiff = diffLinesRaw.length > 0;
  
  const diffLines = useMemo(() => {
    let oldLine = 1;
    let newLine = 1;
    return diffLinesRaw.map((line) => {
      if (line.type === "UNIFIED_DIFF_LINE_TYPE_HUNK_HEADER") {
        const match = line.text?.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        return { ...line, oldNum: null, newNum: null };
      }
      
      let currOld: number | null = null;
      let currNew: number | null = null;
      
      if (line.type === "UNIFIED_DIFF_LINE_TYPE_UNCHANGED") {
        currOld = oldLine++;
        currNew = newLine++;
      } else if (line.type === "UNIFIED_DIFF_LINE_TYPE_DELETE") {
        currOld = oldLine++;
      } else if (line.type === "UNIFIED_DIFF_LINE_TYPE_INSERT") {
        currNew = newLine++;
      }
      
      return { ...line, oldNum: currOld, newNum: currNew };
    });
  }, [diffLinesRaw]);

  // File Content Extraction (from view_file)
  const viewFileUri = step.viewFile?.absolutePathUri ?? "";

  const title = step.codeAction?.description ?? step.metadata?.toolCall?.name ?? "Revision";

  return (
    <div className="fullscreen-viewer">
      <div className="fullscreen-viewer-header">
        <div className="fullscreen-viewer-title">
          {hasDiff ? <IconPencil size={16} /> : <IconFileText size={16} />}
          <span className="title-text">{title}</span>
          
          {hasHistory && (
            <div className="fullscreen-viewer-nav">
              <button 
                className="nav-btn" 
                onClick={handlePrev} 
                disabled={currentIndex === 0}
                title="Previous revision"
              >
                <IconChevronLeft size={14} />
              </button>
              <span className="nav-info">
                Rev {currentIndex + 1} of {totalRevisions}
              </span>
              <button 
                className="nav-btn" 
                onClick={handleNext} 
                disabled={currentIndex === totalRevisions - 1}
                title="Next revision"
              >
                <IconChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
        <button className="fullscreen-viewer-close" onClick={onClose} title="Close">
          <IconX size={18} />
        </button>
      </div>
      
      <div className="fullscreen-viewer-body">
        {hasDiff ? (
          <div className="fullscreen-diff-container">
            <pre className="diff-content">
              {diffLines.map((line, i) => (
                <div key={i} className={`diff-line ${diffLineClass(line.type)}`}>
                  <span className="diff-line-number" title="Original line">{line.oldNum ?? " "}</span>
                  <span className="diff-line-number" title="New line">{line.newNum ?? " "}</span>
                  <span className="diff-prefix">{diffLinePrefix(line.type)}</span>
                  <span className="diff-text">{line.text ?? ""}</span>
                </div>
              ))}
            </pre>
          </div>
        ) : viewFileUri ? (
          <div className="fullscreen-content-container">
            <div className="file-content" style={{ padding: "24px 32px" }}>
              <div>Viewed file: <code>{viewFileUri}</code></div>
              <div style={{ color: "var(--text-tertiary)", marginTop: 8 }}>
                File content is not stored in the language server step data.
              </div>
            </div>
          </div>
        ) : (
          <div className="fullscreen-empty">
            No visual representation available for this revision.
          </div>
        )}
      </div>
    </div>
  );
}
