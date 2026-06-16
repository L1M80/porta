import { describe, expect, it } from "vitest";
import {
  isAntigravityPlaygroundUri,
  workspaceNameFromMetadata,
  workspaceNameFromUri,
} from "../utils/workspaceNames";

describe("workspace name helpers", () => {
  it("decodes URL-encoded path segments", () => {
    expect(
      workspaceNameFromUri(
        "file:///c:/Users/deepk/Downloads/%E3%83%91%E3%83%BC%E3%83%84-20260315T145840Z-3-001",
      ),
    ).toBe("\u30d1\u30fc\u30c4-20260315T145840Z-3-001");
  });

  it("uses decoded repository names before URI segments", () => {
    expect(
      workspaceNameFromMetadata({
        workspaceFolderAbsoluteUri: "file:///tmp/fallback",
        repository: {
          computedName:
            "owner/%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88",
        },
      }),
    ).toBe("\u30d7\u30ed\u30b8\u30a7\u30af\u30c8");
  });

  it("detects Antigravity internal playground URIs", () => {
    expect(
      isAntigravityPlaygroundUri(
        "file:///c:/Users/deepk/.gemini/antigravity/playground/harmonic-constellation",
      ),
    ).toBe(true);
    expect(isAntigravityPlaygroundUri("file:///e:/Work/playground")).toBe(
      false,
    );
  });

  it("can collapse Antigravity playground workspaces into one display group", () => {
    expect(
      workspaceNameFromMetadata(
        {
          workspaceFolderAbsoluteUri:
            "file:///c:/Users/deepk/.gemini/antigravity/playground/harmonic-constellation",
        },
        { collapseAntigravityPlayground: true },
      ),
    ).toBe("Antigravity Playground");
    expect(
      workspaceNameFromMetadata(
        { workspaceFolderAbsoluteUri: "file:///e:/Work/playground" },
        { collapseAntigravityPlayground: true },
      ),
    ).toBe("playground");
  });

  it("falls back to Others without workspace metadata", () => {
    expect(workspaceNameFromMetadata(undefined)).toBe("Others");
  });
});
