import { describe, it, expect } from "vitest";
import {
  extractConversationWorkspaces,
  getMetadata,
  getPrimaryWorkspaceUri,
  withNormalizedConversationWorkspaces,
} from "../metadata.js";

describe("getMetadata", () => {
  it("returns base fields without file access", async () => {
    const meta = await getMetadata();
    expect(meta.ideName).toBe("porta");
    expect(meta.ideVersion).toBe("0.1.0");
    expect(meta.extensionVersion).toBe("0.1.0");
    expect(meta.allowFileAccess).toBeUndefined();
    expect(meta.allWorkspaceTrustGranted).toBeUndefined();
  });

  it("returns base fields with fileAccessGranted=false", async () => {
    const meta = await getMetadata(false);
    expect(meta.ideName).toBe("porta");
    expect(meta.allowFileAccess).toBeUndefined();
  });

  it("includes file access fields when granted", async () => {
    const meta = await getMetadata(true);
    expect(meta.ideName).toBe("porta");
    expect(meta.allowFileAccess).toBe(true);
    expect(meta.allWorkspaceTrustGranted).toBe(true);
  });

  it("returns a fresh object on each call", async () => {
    const a = await getMetadata();
    const b = await getMetadata();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("conversation workspace metadata helpers", () => {
  it("extracts top-level workspace metadata", () => {
    const summary = {
      workspaces: [
        {
          workspaceFolderAbsoluteUri: "file:///home/user/project",
          gitRootAbsoluteUri: "file:///home/user/project",
          repository: { computedName: "local/project" },
          branchName: "main",
        },
      ],
    };

    expect(getPrimaryWorkspaceUri(summary)).toBe("file:///home/user/project");
    expect(extractConversationWorkspaces(summary)[0]).toEqual({
      workspaceFolderAbsoluteUri: "file:///home/user/project",
      gitRootAbsoluteUri: "file:///home/user/project",
      repository: { computedName: "local/project" },
      branchName: "main",
    });
  });

  it("falls back to trajectoryMetadata.workspaces", () => {
    const summary = {
      trajectoryMetadata: {
        workspaces: [
          { workspaceFolderAbsoluteUri: "file:///tmp/from-metadata" },
        ],
      },
    };

    expect(getPrimaryWorkspaceUri(summary)).toBe("file:///tmp/from-metadata");
    const normalized = withNormalizedConversationWorkspaces(
      summary as Record<string, unknown>,
    );

    expect(normalized.workspaces).toEqual([
      { workspaceFolderAbsoluteUri: "file:///tmp/from-metadata" },
    ]);
  });

  it("falls back to trajectoryMetadata.workspaceUris", () => {
    const summary = {
      trajectoryMetadata: {
        workspaceUris: ["file:///tmp/from-uri"],
      },
    };

    expect(extractConversationWorkspaces(summary)).toEqual([
      { workspaceFolderAbsoluteUri: "file:///tmp/from-uri" },
    ]);
  });
});
