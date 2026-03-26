import { describe, it, expect } from "vitest";
import { deriveSessionActivity } from "../hooks/useSessionActivity";
import type { TrajectoryStep } from "../types";

// ── Helpers ──

function makeViewFileStep(
  uri: string,
  startLine?: number,
  endLine?: number,
): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_VIEW_FILE",
    viewFile: { absolutePathUri: uri, startLine, endLine },
  };
}

function makeCodeActionStep(
  uri: string,
  additions = 0,
  deletions = 0,
): TrajectoryStep {
  const lines = [
    ...Array(additions).fill({
      type: "UNIFIED_DIFF_LINE_TYPE_INSERT" as const,
      text: "add",
    }),
    ...Array(deletions).fill({
      type: "UNIFIED_DIFF_LINE_TYPE_DELETE" as const,
      text: "del",
    }),
  ];
  return {
    type: "CORTEX_STEP_TYPE_CODE_ACTION",
    codeAction: {
      actionResult: {
        edit: {
          absoluteUri: uri,
          diff: { unifiedDiff: { lines } },
        },
      },
    },
  };
}

function makeGrepStep(searchPathUri: string, query: string): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_GREP_SEARCH",
    grepSearch: { query, results: [], searchPathUri },
  };
}

function makeRunCommandStep(
  commandLine: string,
  exitCode?: number,
): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_RUN_COMMAND",
    runCommand: { commandLine, exitCode },
  };
}

function makeOutlineStep(uri: string): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE",
    viewFileOutline: { absolutePathUri: uri },
  };
}

function makeCodeItemStep(uri: string, nodePaths: string[]): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_VIEW_CODE_ITEM",
    viewCodeItem: { absoluteUri: uri, nodePaths },
  };
}

// ── Tests ──

describe("deriveSessionActivity", () => {
  it("returns empty activity for no steps", () => {
    const result = deriveSessionActivity([]);
    expect(result.files).toHaveLength(0);
    expect(result.commands).toHaveLength(0);
  });

  // ── viewFile ──

  it("creates a file entry from a viewFile step", () => {
    const step = makeViewFileStep("file:///z:/src/App.tsx");
    const result = deriveSessionActivity([step]);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe("App.tsx");
    expect(result.files[0].events[0].type).toBe("view");
    expect(result.files[0].events[0].detail).toBeUndefined();
  });

  it("includes line range in view event detail", () => {
    const step = makeViewFileStep("file:///z:/src/App.tsx", 10, 50);
    const result = deriveSessionActivity([step]);
    expect(result.files[0].events[0].detail).toBe("#L10–50");
  });

  it("includes start line only when no end line", () => {
    const step = makeViewFileStep("file:///z:/src/App.tsx", 5, undefined);
    const result = deriveSessionActivity([step]);
    expect(result.files[0].events[0].detail).toBe("#L5");
  });

  // ── codeAction ──

  it("creates an edit event from a codeAction step", () => {
    const step = makeCodeActionStep("file:///z:/src/api.ts", 3, 1);
    const result = deriveSessionActivity([step]);
    expect(result.files[0].name).toBe("api.ts");
    expect(result.files[0].events[0].type).toBe("edit");
    expect(result.files[0].events[0].detail).toBe("+3 −1");
  });

  it("groups multiple events on the same file", () => {
    const uri = "file:///z:/src/App.tsx";
    const steps = [
      makeViewFileStep(uri, 1, 20),
      makeCodeActionStep(uri, 2, 0),
      makeViewFileStep(uri, 30, 40),
    ];
    const result = deriveSessionActivity(steps);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].events).toHaveLength(3);
    expect(result.files[0].events[0].type).toBe("view");
    expect(result.files[0].events[1].type).toBe("edit");
    expect(result.files[0].events[2].type).toBe("view");
  });

  // ── grepSearch ──

  it("creates a grep event from a grepSearch step", () => {
    const step = makeGrepStep("file:///z:/src", "TODO");
    const result = deriveSessionActivity([step]);
    expect(result.files[0].events[0].type).toBe("grep");
    expect(result.files[0].events[0].detail).toBe('"TODO"');
  });

  // ── viewFileOutline ──

  it("creates an outline event", () => {
    const step = makeOutlineStep("file:///z:/src/utils.ts");
    const result = deriveSessionActivity([step]);
    expect(result.files[0].events[0].type).toBe("outline");
  });

  // ── viewCodeItem ──

  it("creates a code-item event with node paths", () => {
    const step = makeCodeItemStep("file:///z:/src/parser.ts", ["Foo", "bar"]);
    const result = deriveSessionActivity([step]);
    expect(result.files[0].events[0].type).toBe("code-item");
    expect(result.files[0].events[0].detail).toBe("Foo, bar");
  });

  // ── runCommand ──

  it("adds a command entry for runCommand steps", () => {
    const step = makeRunCommandStep("pnpm test", 0);
    const result = deriveSessionActivity([step]);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].command).toBe("pnpm test");
    expect(result.commands[0].exitCode).toBe(0);
  });

  it("preserves file insertion order (first referenced)", () => {
    const steps = [
      makeViewFileStep("file:///z:/a.ts"),
      makeViewFileStep("file:///z:/b.ts"),
      makeViewFileStep("file:///z:/a.ts"), // second reference — should not create new entry
    ];
    const result = deriveSessionActivity(steps);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].name).toBe("a.ts");
    expect(result.files[1].name).toBe("b.ts");
    expect(result.files[0].events).toHaveLength(2);
  });

  it("treats same URI with different casing as the same file", () => {
    const steps = [
      makeViewFileStep("file:///Z:/src/App.tsx"),
      makeViewFileStep("file:///z:/src/App.tsx"),
    ];
    const result = deriveSessionActivity(steps);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].events).toHaveLength(2);
  });

  it("ignores runCommand steps with no command text", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_RUN_COMMAND",
      runCommand: {},
    };
    const result = deriveSessionActivity([step]);
    expect(result.commands).toHaveLength(0);
  });
});
