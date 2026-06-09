import { describe, it, expect } from "vitest";
import { stepsToMessages } from "../transforms/stepsToMessages";
import type { TrajectoryStep } from "../types";

// ── Helpers ──

function makeUserStep(text: string): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_USER_INPUT",
    userInput: { items: [{ text }] },
  };
}

function makePlannerStep(
  text: string,
  thinking?: string,
  thinkingDuration?: string,
): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
    plannerResponse: {
      modifiedResponse: text,
      thinking,
      thinkingDuration,
    },
  };
}

function makeCommandStep(cmd: string, commandId = "cmd-1"): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_RUN_COMMAND",
    runCommand: { commandLine: cmd, commandId },
  };
}

function makeCommandStatusStep(
  commandId: string,
  status: string,
  combined?: string,
): TrajectoryStep {
  return {
    type: "CORTEX_STEP_TYPE_COMMAND_STATUS",
    commandStatus: { commandId, status, combined },
  };
}

// ── Tests ──

describe("stepsToMessages", () => {
  it("returns empty array for no steps", () => {
    expect(stepsToMessages([])).toEqual([]);
  });

  // ── User input ──

  it("converts user input step to user message", () => {
    const msgs = stepsToMessages([makeUserStep("hello")]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello");
    expect(msgs[0].stepIndex).toBe(0);
  });

  it("preserves proxy clientMessageId on user messages", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_USER_INPUT",
      clientMessageId: "opt-123",
      userInput: { items: [{ text: "hello" }] },
    };

    const msgs = stepsToMessages([step]);

    expect(msgs[0].optimisticId).toBe("opt-123");
  });

  it("joins multiple user input items with double newline", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_USER_INPUT",
      userInput: {
        items: [{ text: "first" }, { text: "second" }],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toBe("first\n\nsecond");
  });

  it("skips user input with only whitespace items", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_USER_INPUT",
      userInput: { items: [{ text: "  " }, { text: "\n" }] },
    };
    expect(stepsToMessages([step])).toHaveLength(0);
  });

  it("trims user input text", () => {
    const msgs = stepsToMessages([makeUserStep("  hello world  ")]);
    expect(msgs[0].content).toBe("hello world");
  });

  // ── Planner response ──

  it("converts planner response to assistant message", () => {
    const msgs = stepsToMessages([
      makePlannerStep("response text", "thinking text", "2.5s"),
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].content).toBe("response text");
    expect(msgs[0].thinking).toBe("thinking text");
    expect(msgs[0].thinkingDuration).toBe("2.5s");
  });

  it("uses planner response items when modifiedResponse is empty", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
      plannerResponse: {
        modifiedResponse: "",
        items: [{ text: "Inspect current UI" }, { text: "Add plan panel" }],
      },
    };

    const msgs = stepsToMessages([step]);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    expect(msgs[0].content).toBe("Inspect current UI\n\nAdd plan panel");
  });

  it("skips planner response with empty text and no thinking", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
      plannerResponse: {
        modifiedResponse: "  ",
        thinking: "",
      },
    };
    expect(stepsToMessages([step])).toHaveLength(0);
  });

  it("includes planner response with only thinking", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
      plannerResponse: {
        modifiedResponse: "",
        thinking: "let me think",
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].thinking).toBe("let me think");
  });

  // ── Run command ──

  it("converts run command to system message with step data", () => {
    const msgs = stepsToMessages([makeCommandStep("npm test")]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].step?.runCommand?.commandLine).toBe("npm test");
  });

  // ── Command status ──

  it("merges command status output into matching run command", () => {
    const steps: TrajectoryStep[] = [
      makeCommandStep("ls -la", "cmd-42"),
      makeCommandStatusStep(
        "cmd-42",
        "CORTEX_STEP_STATUS_DONE",
        "file1.txt\nfile2.txt",
      ),
    ];
    const msgs = stepsToMessages(steps);
    // Only the run command generates a visible message
    expect(msgs).toHaveLength(1);
    expect(msgs[0].step?.runCommand?.combinedOutput?.full).toBe(
      "file1.txt\nfile2.txt",
    );
  });

  it("ignores command status for non-DONE status", () => {
    const steps: TrajectoryStep[] = [
      makeCommandStep("ls", "cmd-1"),
      makeCommandStatusStep("cmd-1", "CORTEX_STEP_STATUS_RUNNING", "partial"),
    ];
    const msgs = stepsToMessages(steps);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].step?.runCommand?.combinedOutput).toBeUndefined();
  });

  // ── Code action ──

  it("converts code action to system message", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_CODE_ACTION",
      codeAction: { description: "edit file" },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].type).toBe("CORTEX_STEP_TYPE_CODE_ACTION");
  });

  // ── Send command input (terminate) ──

  it("shows termination message", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_SEND_COMMAND_INPUT",
      sendCommandInput: { terminate: true },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("termination");
  });

  it("skips non-terminate send command input", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_SEND_COMMAND_INPUT",
      sendCommandInput: { terminate: false },
    };
    expect(stepsToMessages([step])).toHaveLength(0);
  });

  // ── Grep search ──

  it("formats grep search message", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_GREP_SEARCH",
      grepSearch: {
        query: "TODO",
        results: [{}, {}, {}],
        searchPathUri: "file:///home/user/src",
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("TODO");
    expect(msgs[0].content).toContain("src");
    expect(msgs[0].content).toContain("3 results");
    expect(msgs[0].icon).toBe("search");
  });

  it("uses singular 'result' for 1 match", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_GREP_SEARCH",
      grepSearch: {
        query: "needle",
        results: [{}],
        searchPathUri: "file:///home/src",
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("1 result");
    expect(msgs[0].content).not.toContain("1 results");
  });

  // ── View file ──

  it("formats view file message with range", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_VIEW_FILE",
      viewFile: {
        absolutePathUri: "file:///home/user/src/main.ts",
        startLine: 10,
        endLine: 50,
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("main.ts");
    expect(msgs[0].content).toContain("#L10-50");
    expect(msgs[0].icon).toBe("eye");
  });

  it("formats view file message without range", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_VIEW_FILE",
      viewFile: {
        absolutePathUri: "file:///home/user/src/main.ts",
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("main.ts");
    expect(msgs[0].content).not.toContain("#L");
  });

  // ── View file outline ──

  it("formats view file outline message", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE",
      viewFileOutline: {
        absolutePathUri: "file:///home/user/src/App.tsx",
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("App.tsx");
    expect(msgs[0].icon).toBe("list");
  });

  // ── View code item ──

  it("formats view code item with node paths", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_VIEW_CODE_ITEM",
      viewCodeItem: {
        absoluteUri: "file:///home/user/src/utils.ts",
        nodePaths: ["Foo.bar", "Baz"],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("utils.ts");
    expect(msgs[0].content).toContain("Foo.bar, Baz");
    expect(msgs[0].icon).toBe("file-search");
  });

  // ── List directory ──

  it("formats list directory message", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_LIST_DIRECTORY",
      listDirectory: {
        directoryPathUri: "file:///home/user/src",
        results: [{}, {}, {}, {}, {}],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("src/");
    expect(msgs[0].content).toContain("5 items");
    expect(msgs[0].icon).toBe("folder");
  });

  // ── Find ──

  it("formats find message", () => {
    const step: TrajectoryStep = {
      type: "CORTEX_STEP_TYPE_FIND",
      find: {
        pattern: "*.ts",
        results: [{}, {}],
      },
    };
    const msgs = stepsToMessages([step]);
    expect(msgs[0].content).toContain("*.ts");
    expect(msgs[0].content).toContain("2 results");
    expect(msgs[0].icon).toBe("search");
  });

  // ── Collapsing consecutive system messages ──

  it("collapses consecutive text-only system messages", () => {
    const steps: TrajectoryStep[] = [
      {
        type: "CORTEX_STEP_TYPE_GREP_SEARCH",
        grepSearch: { query: "a", results: [], searchPathUri: "file:///x" },
      },
      {
        type: "CORTEX_STEP_TYPE_VIEW_FILE",
        viewFile: { absolutePathUri: "file:///y/z.ts" },
      },
    ];
    const msgs = stepsToMessages(steps);
    // Both are text-only system messages → should be collapsed into 1
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toContain("a");
    expect(msgs[0].content).toContain("z.ts");
  });

  it("does NOT collapse system messages that carry step data", () => {
    const steps: TrajectoryStep[] = [
      makeCommandStep("ls"),
      makeCommandStep("pwd"),
    ];
    const msgs = stepsToMessages(steps);
    // Both have step data → not collapsed
    expect(msgs).toHaveLength(2);
  });

  // ── Full conversation flow ──

  it("handles a realistic multi-step conversation", () => {
    const steps: TrajectoryStep[] = [
      makeUserStep("What files are in this directory?"),
      makePlannerStep("Let me check.", "I should list the directory"),
      makeCommandStep("ls -la", "cmd-1"),
      makeCommandStatusStep(
        "cmd-1",
        "CORTEX_STEP_STATUS_DONE",
        "total 32\ndrwxr-xr-x 4 user ...",
      ),
      makePlannerStep("Here are the files in this directory."),
    ];

    const msgs = stepsToMessages(steps);

    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].thinking).toBe("I should list the directory");
    expect(msgs[2].role).toBe("system");
    expect(msgs[2].step?.runCommand?.combinedOutput?.full).toContain(
      "total 32",
    );
    expect(msgs[3].role).toBe("assistant");
    expect(msgs).toHaveLength(4);
  });
});
