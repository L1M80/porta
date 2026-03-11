import { describe, it, expect } from "vitest";
import { stepsToMessages } from "../transforms/stepsToMessages";
import type { TrajectoryStep } from "../types";

// ── Edge cases not covered by the main test file ──

describe("stepsToMessages — edge cases", () => {
  // ── User input with media ──

  it("includes user message with media and no text", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_USER_INPUT",
      userInput: {
        items: [],
        media: [{ mimeType: "image/png", inlineData: "base64data" }],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("");
    expect(msgs[0].media).toHaveLength(1);
  });

  it("includes user message with both text and media", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_USER_INPUT",
      userInput: {
        items: [{ text: "Analyze this image" }],
        media: [{ mimeType: "image/jpeg", inlineData: "abc123" }],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Analyze this image");
    expect(msgs[0].media).toHaveLength(1);
  });

  // ── Skipping steps with missing data ──

  it("skips user input step with no items", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_USER_INPUT",
      userInput: undefined,
    };
    expect(stepsToMessages([step])).toHaveLength(0);
  });

  it("skips planner response with no plannerResponse", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
    };
    expect(stepsToMessages([step])).toHaveLength(0);
  });

  it("skips run command with no command line at all", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_RUN_COMMAND",
      runCommand: {},
    };
    expect(stepsToMessages([step])).toHaveLength(0);
  });

  it("emits run command when only proposedCommandLine is present (waiting for approval)", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_RUN_COMMAND",
      status: "CORTEX_STEP_STATUS_WAITING",
      runCommand: { proposedCommandLine: "rm -rf /" },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].step?.runCommand?.proposedCommandLine).toBe("rm -rf /");
  });

  // ── Run command with fallback to command field ──

  it("uses command field when commandLine is missing", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_RUN_COMMAND",
      runCommand: { command: "npm" },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
  });

  // ── Command status edge cases ──

  it("command status with no matching run command is a no-op", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_COMMAND_STATUS",
      commandStatus: {
        commandId: "orphan-id",
        status: "CORTEX_STEP_STATUS_DONE",
        combined: "output",
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(0);
  });

  it("command status DONE with empty combined does not set output", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        runCommand: { commandLine: "ls", commandId: "cmd-1" },
      },
      {
        type: "CORTEX_STEP_TYPE_COMMAND_STATUS",
        commandStatus: {
          commandId: "cmd-1",
          status: "CORTEX_STEP_STATUS_DONE",
          combined: "",
        },
      },
    ];
    const msgs = stepsToMessages(steps);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].step?.runCommand?.combinedOutput).toBeUndefined();
  });

  // ── Grep search edge cases ──

  it("grep search with 0 results shows '0 results'", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_GREP_SEARCH",
      grepSearch: {
        query: "nope",
        results: [],
        searchPathUri: "file:///home/user/src",
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("0 results");
  });

  it("grep search with no searchPathUri still works", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_GREP_SEARCH",
      grepSearch: { query: "test", results: [{}, {}] },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("test");
    expect(msgs[0].content).toContain("2 results");
  });

  // ── View file edge cases ──

  it("view file with only startLine (no endLine) omits range", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_VIEW_FILE",
      viewFile: {
        absolutePathUri: "file:///home/user/main.ts",
        startLine: 5,
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).not.toContain("#L");
  });

  // ── View code item edge cases ──

  it("view code item with empty nodePaths", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_VIEW_CODE_ITEM",
      viewCodeItem: {
        absoluteUri: "file:///utils.ts",
        nodePaths: [],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("utils.ts");
    expect(msgs[0].content).not.toContain("→");
  });

  // ── List directory edge case ──

  it("list directory with empty results", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_LIST_DIRECTORY",
      listDirectory: {
        directoryPathUri: "file:///empty",
        results: [],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("0 items");
  });

  // ── Find edge case ──

  it("find with 1 result uses singular", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_FIND",
      find: { pattern: "*.tsx", results: [{}] },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("1 result");
    expect(msgs[0].content).not.toContain("1 results");
  });

  // ── Collapse edge cases ──

  it("system message with step data breaks collapse chain", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_GREP_SEARCH",
        grepSearch: { query: "a", results: [], searchPathUri: "file:///x" },
      },
      {
        type: "CORTEX_STEP_TYPE_RUN_COMMAND",
        runCommand: { commandLine: "ls", commandId: "cmd-1" },
      },
      {
        type: "CORTEX_STEP_TYPE_VIEW_FILE",
        viewFile: { absolutePathUri: "file:///y.ts" },
      },
    ];
    const msgs = stepsToMessages(steps);
    // grep → collapse target, run command → has step data (breaks chain), view file → new collapse
    expect(msgs).toHaveLength(3);
  });

  it("user/assistant messages between system messages prevent collapse", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_VIEW_FILE",
        viewFile: { absolutePathUri: "file:///a.ts" },
      },
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "hello" }] },
      },
      {
        type: "CORTEX_STEP_TYPE_VIEW_FILE",
        viewFile: { absolutePathUri: "file:///b.ts" },
      },
    ];
    const msgs = stepsToMessages(steps);
    expect(msgs).toHaveLength(3);
  });

  // ── stepIndex tracking ──

  it("stepIndex reflects original step position", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "q1" }] },
      },
      {
        type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
        plannerResponse: { modifiedResponse: "a1" },
      },
      {
        type: "CORTEX_STEP_TYPE_USER_INPUT",
        userInput: { items: [{ text: "q2" }] },
      },
    ];
    const msgs = stepsToMessages(steps);
    expect(msgs[0].stepIndex).toBe(0);
    expect(msgs[1].stepIndex).toBe(1);
    expect(msgs[2].stepIndex).toBe(2);
  });

  // ── Unknown step types ──

  it("silently ignores unknown step types", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_UNKNOWN_FUTURE" as string,
    };
    expect(stepsToMessages([step])).toHaveLength(0);
  });
});
