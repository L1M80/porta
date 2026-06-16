import { describe, it, expect } from "vitest";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractConversationWorkspaces,
  getMetadata,
  getPrimaryWorkspaceUri,
  scanDiskConversations,
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

describe("scanDiskConversations", () => {
  it("scans .pb and .db conversations while ignoring SQLite sidecar files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "porta-conversations-"));
    try {
      await writeFile(join(dir, "legacy.pb"), "");
      await writeFile(join(dir, "modern.db"), "");
      await writeFile(join(dir, "modern.db-wal"), "");
      await writeFile(join(dir, "modern.db-shm"), "");
      await writeFile(join(dir, "notes.txt"), "");

      const legacyTime = new Date("2026-06-01T00:00:00.000Z");
      const modernTime = new Date("2026-06-02T00:00:00.000Z");
      await utimes(join(dir, "legacy.pb"), legacyTime, legacyTime);
      await utimes(join(dir, "modern.db"), modernTime, modernTime);

      const results = await scanDiskConversations(dir);

      expect(results.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        { id: "legacy", mtime: legacyTime.toISOString() },
        { id: "modern", mtime: modernTime.toISOString() },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deduplicates matching .pb and .db files by newest mtime", async () => {
    const dir = await mkdtemp(join(tmpdir(), "porta-conversations-"));
    try {
      await writeFile(join(dir, "same.pb"), "");
      await writeFile(join(dir, "same.db"), "");

      const oldTime = new Date("2026-06-01T00:00:00.000Z");
      const newTime = new Date("2026-06-03T00:00:00.000Z");
      await utimes(join(dir, "same.pb"), oldTime, oldTime);
      await utimes(join(dir, "same.db"), newTime, newTime);

      expect(await scanDiskConversations(dir)).toEqual([
        { id: "same", mtime: newTime.toISOString() },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
