import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  uriToWorkspaceId,
  normalizeWorkspaceId,
  PersistentMap,
} from "../routing.js";

describe("uriToWorkspaceId", () => {
  it("converts file:/// URI to file_ prefixed ID", () => {
    expect(uriToWorkspaceId("file:///home/user/project")).toBe(
      "file_home_user_project",
    );
  });

  it("replaces all slashes", () => {
    expect(uriToWorkspaceId("file:///a/b/c/d")).toBe("file_a_b_c_d");
  });

  it("handles root path", () => {
    expect(uriToWorkspaceId("file:///")).toBe("file_");
  });

  it("preserves non-file:// URIs as-is (just replaces slashes)", () => {
    // Edge case: if the URI doesn't start with file:///,
    // the replace only strips matching prefix
    expect(uriToWorkspaceId("other:///foo/bar")).toBe("other:___foo_bar");
  });

  it("handles deeply nested paths", () => {
    expect(uriToWorkspaceId("file:///home/l1m80/work/porta")).toBe(
      "file_home_l1m80_work_porta",
    );
  });

  it("converts Windows file URIs", () => {
    expect(uriToWorkspaceId("file:///C:/Users/project")).toBe(
      "file_C:_Users_project",
    );
  });
});

describe("normalizeWorkspaceId", () => {
  it("makes CLI-format and URI-derived IDs equal for Windows paths", () => {
    // CLI --workspace_id uses URL-encoded colons and lowercase drive
    const cliId = "file_e_3A_Work_novels";
    // uriToWorkspaceId("file:///E:/Work/novels") keeps literal colon
    const uriId = "file_E:_Work_novels";

    expect(normalizeWorkspaceId(cliId)).toBe(normalizeWorkspaceId(uriId));
  });

  it("normalizes C: drive paths consistently", () => {
    const cliId = "file_c_3A_Users_deepk_Downloads_porta";
    const uriId = "file_C:_Users_deepk_Downloads_porta";

    expect(normalizeWorkspaceId(cliId)).toBe(normalizeWorkspaceId(uriId));
  });

  it("is a no-op for Linux paths (no colons)", () => {
    const id = "file_home_l1m80_work_porta";
    expect(normalizeWorkspaceId(id)).toBe(id);
  });

  it("lowercases everything", () => {
    expect(normalizeWorkspaceId("file_Home_User_Project")).toBe(
      "file_home_user_project",
    );
  });

  it("replaces all colons (edge case: multiple drives is impossible but safe)", () => {
    expect(normalizeWorkspaceId("a:b:c")).toBe("a_3ab_3ac");
  });
});

describe("PersistentMap", () => {
  it("persists string entries and reloads them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "porta-affinity-"));
    const file = join(dir, "porta_affinity.json");

    try {
      const map = new PersistentMap(file, { persist: true });
      map.set("cascade-a", "file_home_user_project");
      map.set("cascade-b", "file_home_user_other");

      expect(JSON.parse(await readFile(file, "utf-8"))).toEqual({
        "cascade-a": "file_home_user_project",
        "cascade-b": "file_home_user_other",
      });

      const reloaded = new PersistentMap(file, { persist: true });
      expect(reloaded.get("cascade-a")).toBe("file_home_user_project");
      expect(reloaded.get("cascade-b")).toBe("file_home_user_other");

      reloaded.delete("cascade-a");
      expect(JSON.parse(await readFile(file, "utf-8"))).toEqual({
        "cascade-b": "file_home_user_other",
      });

      reloaded.clear();
      expect(JSON.parse(await readFile(file, "utf-8"))).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
